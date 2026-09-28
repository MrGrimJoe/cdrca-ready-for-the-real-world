# Licensing

## This repo's license

This repo (the tooling: CLI, installer, VS Code extension) is licensed
under the **MrMIB License v1.0** — see [LICENSE.md](../LICENSE.md) for
the full text. Short version: free to use and run, including
commercially, with credit to MrMIB; no forking or derivative works
without explicit permission in this README; the software itself can't
be resold or repackaged. This is a decision about *this tooling repo*
only — it says nothing about what license the CDRCA language itself
uses upstream; that's entirely Muhammad Ayyan's call in his own repo.

## The IOSLF framework

CDRCA's language creator, Muhammad Ayyan, has also separately authored a
full license framework called **IOSLF (Islamic Open Source License
Framework) v2.1**:

<https://github.com/Muhammad-Ayyan-no1/IOSLF--Islamic-OpenSource-License-Framework->

IOSLF is a values-aligned license system for Muslim creators, with
configurable operating modes rather than a single fixed license text —
projects that adopt it fill in a `PROJECT-CONFIG.md` with their own
specific decisions (a named scholar, a Hisbah Officer, payment/
contribution logistics, a vetting registry, and so on).

**This is not the same thing as this repo's [LICENSE.md](../LICENSE.md).**
This repo's tooling is licensed under MrMIB License v1.0 (see above).
IOSLF is a broader, separately-published framework by CDRCA's language
creator. Neither this repo nor, as far as this repo knows, the CDRCA
language itself is currently licensed under IOSLF — this section exists
only to credit and point to the framework, not to claim it applies here.

### Why the manifest's `license` field can represent this

The `cdrca.json` manifest's [`license` field](./MANIFEST-SPEC.md) is
deliberately free text rather than a closed enum of known license names.
That's not specific to IOSLF — it's just what lets the field accurately
represent whatever license a package author has actually adopted,
including IOSLF-framework licensing, if and when someone chooses it.
This doc doesn't change that field's behavior; it's just making the
existing design's flexibility explicit.

### Adopting IOSLF for this project

This repo's tooling is now licensed under MrMIB License v1.0, so this
would mean relicensing rather than filling a gap. If a future maintainer
wants to revisit that and adopt IOSLF v2.1 for this repo instead, that
starts with filling in a `PROJECT-CONFIG.md` at the repo root per the
framework's own instructions, then opening a PR.

That file isn't included in this repo. It requires real, specific
decisions that only the project's actual maintainer(s) can make — it
is intentionally not drafted, templated, or pre-filled here.
