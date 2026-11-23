// ==============================================================================
// Prometheus metrics (REV-220)
// ==============================================================================
// A small registry that renders the Prometheus text exposition format (version 0.0.4). It replaces a
// dependency (prom-client): the apps need counters, gauges and one histogram, and every image stays smaller.
import { monitorEventLoopDelay } from 'node:perf_hooks';

export type Labels = Record<string, string | number>;

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const escapeValue = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const escapeHelp = (help: string): string => help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');

function labelText(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return '';
  return `{${keys.map((key) => `${key}="${escapeValue(String(labels[key]))}"`).join(',')}}`;
}

function checkNames(name: string, labelNames: readonly string[]): void {
  if (!NAME.test(name)) throw new Error(`Invalid metric name: ${name}`);
  for (const label of labelNames) if (!LABEL.test(label) || label.startsWith('__')) throw new Error(`Invalid label name: ${label}`);
}

function keyOf(labelNames: readonly string[], labels: Labels): string {
  for (const key of Object.keys(labels)) if (!labelNames.includes(key)) throw new Error(`Unexpected label ${key}`);
  return labelNames.map((name) => `${name}=${String(labels[name] ?? '')}`).join('\u0000');
}

interface Metric {
  name: string;
  render: () => string[];
}

export class Counter implements Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(readonly name: string, private help: string, private labelNames: readonly string[] = []) {
    checkNames(name, labelNames);
  }
  inc(labels: Labels = {}, amount = 1): void {
    if (amount < 0) throw new Error('A counter only goes up');
    const key = keyOf(this.labelNames, labels);
    const entry = this.values.get(key) ?? { labels, value: 0 };
    entry.value += amount;
    this.values.set(key, entry);
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${labelText(labels)} ${value}`);
    return lines;
  }
}

export class Gauge implements Metric {
  private values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    private help: string,
    private labelNames: readonly string[] = [],
    private collect?: (gauge: Gauge) => void | Promise<void>,
  ) {
    checkNames(name, labelNames);
  }
  set(labels: Labels, value: number): void {
    this.values.set(keyOf(this.labelNames, labels), { labels, value });
  }
  async refresh(): Promise<void> {
    if (this.collect) await this.collect(this);
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) lines.push(`${this.name}${labelText(labels)} ${value}`);
    return lines;
  }
}

export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export class Histogram implements Metric {
  private series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(readonly name: string, private help: string, private labelNames: readonly string[] = [], private buckets: readonly number[] = DEFAULT_BUCKETS) {
    checkNames(name, labelNames);
  }
  observe(labels: Labels, value: number): void {
    const key = keyOf(this.labelNames, labels);
    const entry = this.series.get(key) ?? { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.buckets.forEach((bound, index) => {
      if (value <= bound) entry.counts[index] = (entry.counts[index] ?? 0) + 1;
    });
    entry.sum += value;
    entry.count += 1;
    this.series.set(key, entry);
  }
  render(): string[] {
    const lines = [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.series.values()) {
      this.buckets.forEach((bound, index) => lines.push(`${this.name}_bucket${labelText({ ...labels, le: String(bound) })} ${counts[index] ?? 0}`));
      lines.push(`${this.name}_bucket${labelText({ ...labels, le: '+Inf' })} ${count}`);
      lines.push(`${this.name}_sum${labelText(labels)} ${sum}`);
      lines.push(`${this.name}_count${labelText(labels)} ${count}`);
    }
    return lines;
  }
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export class MetricsRegistry {
  private metrics: Metric[] = [];
  private gauges: Gauge[] = [];

  private add<T extends Metric>(metric: T): T {
    if (this.metrics.some((existing) => existing.name === metric.name)) throw new Error(`Metric ${metric.name} is already registered`);
    this.metrics.push(metric);
    return metric;
  }
  counter(name: string, help: string, labelNames: readonly string[] = []): Counter {
    return this.add(new Counter(name, help, labelNames));
  }
  gauge(name: string, help: string, labelNames: readonly string[] = [], collect?: (gauge: Gauge) => void | Promise<void>): Gauge {
    const gauge = this.add(new Gauge(name, help, labelNames, collect));
    this.gauges.push(gauge);
    return gauge;
  }
  histogram(name: string, help: string, labelNames: readonly string[] = [], buckets?: readonly number[]): Histogram {
    return this.add(new Histogram(name, help, labelNames, buckets));
  }
  /** The text a Prometheus server scrapes. A gauge whose collector fails keeps its last value. */
  async render(): Promise<string> {
    for (const gauge of this.gauges) {
      try {
        await gauge.refresh();
      } catch {
        // A failing collector (Redis down) must not break the whole scrape
      }
    }
    return `${this.metrics.flatMap((metric) => metric.render()).join('\n')}\n`;
  }
}

/** Process metrics every service exposes: uptime, memory, CPU and event-loop delay */
export function registerProcessMetrics(registry: MetricsRegistry, service: string): void {
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();
  const started = Date.now();
  const labels = { service };
  registry.gauge('revamp_process_uptime_seconds', 'Seconds since the process started', ['service'], (g) => g.set(labels, (Date.now() - started) / 1000));
  registry.gauge('revamp_process_resident_memory_bytes', 'Resident set size in bytes', ['service'], (g) => g.set(labels, process.memoryUsage().rss));
  registry.gauge('revamp_process_heap_used_bytes', 'V8 heap in use in bytes', ['service'], (g) => g.set(labels, process.memoryUsage().heapUsed));
  registry.gauge('revamp_process_cpu_seconds_total', 'User plus system CPU time in seconds', ['service'], (g) => {
    const usage = process.cpuUsage();
    g.set(labels, (usage.user + usage.system) / 1e6);
  });
  registry.gauge('revamp_eventloop_delay_p99_seconds', 'p99 event-loop delay in seconds', ['service'], (g) => {
    g.set(labels, Number.isFinite(loop.percentile(99)) ? loop.percentile(99) / 1e9 : 0);
    loop.reset();
  });
}
