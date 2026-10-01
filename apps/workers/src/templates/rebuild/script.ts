/**
 * The rebuild's page script (REV-110): slider steps. The page works without it: the controls stay hidden and the
 * track is a plain scroller. The live palette listener belongs to the booking script, so only one runs.
 */
export const REBUILD_SCRIPT = `<script>
(function() {
  document.querySelectorAll('.rb-slider').forEach(function(slider) {
    var track = slider.querySelector('.rb-track');
    var controls = slider.querySelector('.rb-slider-controls');
    if (!track || !controls) return;
    controls.removeAttribute('hidden');
    controls.querySelectorAll('[data-slide-step]').forEach(function(button) {
      button.addEventListener('click', function() {
        var slide = track.querySelector('.rb-slide');
        if (!slide) return;
        var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
        var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        track.scrollBy({ left: Number(button.getAttribute('data-slide-step')) * (slide.getBoundingClientRect().width + gap), behavior: still ? 'auto' : 'smooth' });
      });
    });
  });
})();
</script>`;
