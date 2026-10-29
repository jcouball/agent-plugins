# Notice

This repository contains work derived from third-party sources. Each section
records where a vendored file came from, and [MAINTAINING.md](MAINTAINING.md)
says how it is kept current. A skill, under "Vendoring a third-party skill",
is modified locally, its upstream updates are ported by hand, and the git
history is the record of the local changes. A library, under "Vendoring a
library", is never modified and is replaced from a new upstream release.

## plugins/writing/skills/unslop

Derived from the "unslop" skill in poteto's pstack plugin. MIT licensed.

    repo:   https://github.com/cursor/plugins
    path:   pstack/skills/unslop/SKILL.md
    commit: bc697d0a5a163cec979e362b601e36f5616083fd

## plugins/github/scripts/vendor/js-yaml.mjs

The ESM build of js-yaml, taken from the npm tarball because the repository
does not commit its `dist/` directory, so the source commit below is where
the release was built from and not somewhere the file can be fetched. The
tarball's `LICENSE` sits beside the file as `js-yaml.LICENSE`, since the
plugin directory is what an install distributes and this file is not in it.
MIT licensed.

    package:        js-yaml@5.5.0
    tarball:        https://registry.npmjs.org/js-yaml/-/js-yaml-5.5.0.tgz
    integrity:      sha512-paNr4LFIFPjeeSmwNYdrb8FafLLG/Cr2Af3GjbsHJ5CxIjH4r0c2emlmRdAtpPAieP1gRVzk6buBbVP5gBMGAg==
    tarball path:   package/dist/js-yaml.mjs
    file sha256:    213470960d9c2ff1d01f9164e5017749bfc383d8a6ebb8683f35c76e8c6d052b
    license path:   package/LICENSE
    license sha256: a07bc24468b9654ce76a547d47a2db282d07733b715db4c73a98bd63961f9550
    source repo:    https://github.com/nodeca/js-yaml
    source commit:  cb62b2dbbaa0b3e7379d83a5d69d8d52d21b6efb

## License

The vendored work above is used under the MIT License. Copyright (c) 2026
Lauren Tan (unslop); Copyright (C) 2011-2015 by Vitaly Puzrin (js-yaml).

    Permission is hereby granted, free of charge, to any person obtaining a
    copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to permit
    persons to whom the Software is furnished to do so, subject to the
    following conditions:

    The above copyright notice and this permission notice shall be included
    in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
    SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
