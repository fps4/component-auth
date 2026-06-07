# component-auth

Shared authentication component for the FPS4 platform.

## Documentation layout

Documentation for this repository lives under `docs/` and follows the Maestro two-plane documentation standard. There are two shelves:

- **[Product shelf](docs/product/README.md)** (`docs/product/`) — what the component does: functional specifications and product-facing references.
- **[Architecture shelf](docs/architecture/README.md)** (`docs/architecture/`) — how the component is built: technical designs and architecture decision records.
  - **[Decision records](docs/architecture/decisions/README.md)** (`docs/architecture/decisions/`) — numbered ADRs in Context / Decision / Consequences form.

The preferred entry point for documentation is the **[documentation index](docs/README.md)**, which links both shelves in one place.

Every indexed page under `docs/` carries a `maestro:` frontmatter header so the Maestro workspace can list and search it without manual curation.
