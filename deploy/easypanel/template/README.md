# Easypanel Template

> **Template mantido pela comunidade, não testado no CI.** O único caminho oficial e testado é o Docker Compose ([`docker/`](https://github.com/patrickbrandao/thinker/tree/main/docker)). Repositório: [patrickbrandao/thinker](https://github.com/patrickbrandao/thinker) · [issues](https://github.com/patrickbrandao/thinker/issues).

This directory contains the Thinker template files intended for the upstream
[`easypanel-io/templates`](https://github.com/easypanel-io/templates)
repository.

To submit upstream, copy these files into:

```text
templates/thinker/index.ts
templates/thinker/meta.yaml
```

The template provisions:

- Thinker app service from `tmsoftbrasil/thinker:0.1`.
- PostgreSQL 16 service.
- Persistent app volume for compressed request recordings.
- Generated database password, Better Auth secret, and Thinker encryption key.
- HTTPS domain proxy on port `2099`.
