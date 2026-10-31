# Complexity criteria and project components

| Criterion | Description |
|---|---|
| Business Analysis | Business analysis document: vision, problem, stakeholders, scope, epics, user stories, use case diagram, risks; defended before the committee. |
| Back-end | Express API, BullMQ background workers, tenant data isolation, contact rights registry, purchase of contact rights, payment ledger. |
| Front-end | React and Material UI dashboard, lead purchase interface, public page for business owners. |
| Refined UX | User scenarios for studios and business owners, wireframes of the purchase and lead list screens, usability test. |
| Database | MongoDB: collections and indexes for tenants, businesses, leads, contact rights, purchases and ledger; ER diagram. |
| Containerization | Docker images for the API, workers and dashboard; Compose files for development and production. |
| CI/CD pipeline | GitHub Actions: type check, linter, tests, build and deploy. |
| Automated tests (70%+ coverage) | Unit and integration tests with Vitest, with coverage measured and enforced at no less than 70%. |
| API documentation | OpenAPI 3.0 specification generated from the Zod schemas. |
| Quantitative testing | Market simulation (studio demand, lead prices), audit repeatability, prototype quality evaluation; final report. |
