# Notice

This repository contains work derived from third-party sources. Each section
records where a vendored file came from, and [MAINTAINING.md](MAINTAINING.md)
says how it is kept current. A skill, under "Vendoring a third-party skill",
is modified locally, its upstream updates are ported by hand, and the git
history is the record of the local changes. A library, under "Vendoring a
library", is never modified and is replaced from a new upstream release.
Each work's license text is the license file beside it, named in its section;
that file is what an install distributes, and this file does not repeat it.

## plugins/writing/skills/unslop

Derived from the "unslop" skill in poteto's pstack plugin. MIT licensed,
Copyright (c) 2026 Lauren Tan. pstack's `LICENSE` sits beside the skill as
`plugins/writing/skills/unslop/LICENSE`.

    repo:           https://github.com/cursor/plugins
    path:           pstack/skills/unslop/SKILL.md
    commit:         bc697d0a5a163cec979e362b601e36f5616083fd
    license path:   pstack/LICENSE
    license sha256: bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e

## plugins/github/scripts/vendor/js-yaml.mjs

The ESM build of js-yaml, taken from the npm tarball because the repository
does not commit its `dist/` directory, so the source commit below is where
the release was built from and not somewhere the file can be fetched. MIT
licensed, Copyright (C) 2011-2015 by Vitaly Puzrin. The tarball's `LICENSE`
sits beside the file as `js-yaml.LICENSE`.

    package:        js-yaml@5.5.0
    tarball:        https://registry.npmjs.org/js-yaml/-/js-yaml-5.5.0.tgz
    integrity:      sha512-paNr4LFIFPjeeSmwNYdrb8FafLLG/Cr2Af3GjbsHJ5CxIjH4r0c2emlmRdAtpPAieP1gRVzk6buBbVP5gBMGAg==
    tarball path:   package/dist/js-yaml.mjs
    file sha256:    213470960d9c2ff1d01f9164e5017749bfc383d8a6ebb8683f35c76e8c6d052b
    license path:   package/LICENSE
    license sha256: a07bc24468b9654ce76a547d47a2db282d07733b715db4c73a98bd63961f9550
    source repo:    https://github.com/nodeca/js-yaml
    source commit:  cb62b2dbbaa0b3e7379d83a5d69d8d52d21b6efb
