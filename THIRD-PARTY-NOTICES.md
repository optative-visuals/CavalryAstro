# Third-party notices

CavalryAstro is licensed under GPL-3.0-or-later (see LICENSE). It includes data from two
third-party projects, which keep their own licences:

## d3-celestial (BSD-3-Clause)

`assets/sky/constellations.json` (the constellation lines, borders and names) is derived from the
constellation data in [d3-celestial](https://github.com/ofrohn/d3-celestial), pinned at commit
`7e720a3de062059d4c5400a379146a601d9010e0`. The licence text below is copied verbatim from that
commit's LICENSE file (https://raw.githubusercontent.com/ofrohn/d3-celestial/7e720a3de062059d4c5400a379146a601d9010e0/LICENSE).

```
Copyright (c) 2015, Olaf Frohn
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## HYG Database (CC BY-SA 4.0)

`assets/sky/stars.json` (the star catalogue) is derived from the
[HYG Database](https://github.com/astronexus/HYG-Database) version 4.1, pinned at commit
`c7f7f883fe678cc7680169a50ccd7dcc49b060ce`, by astronexus (the HYG Database's author; see
http://www.astronexus.com/hyg). The HYG Database is licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License](https://creativecommons.org/licenses/by-sa/4.0/).

Changes made to the HYG data for CavalryAstro: the catalogue is filtered to stars of magnitude 7.0 or
brighter, the Sun is dropped, the columns are reduced to position, magnitude, colour index, constellation,
name and Bayer designation, values are rounded, and the result is re-encoded as JSON.

`assets/sky/stars.json` is itself licensed under CC BY-SA 4.0, so any copy or adaptation of it must
keep this attribution and carry the same licence.
