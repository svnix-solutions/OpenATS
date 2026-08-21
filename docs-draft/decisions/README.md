# Decision records

One file per decision that was not obvious, is expensive to reverse, or that someone will otherwise ask about again in six months.

Code comments explain why a line is the way it is, and OpenATS is good at those. This directory is for the decisions that are bigger than any one file: how tenancy works, why the identity provider is what it is, why a whole subsystem is shaped the way it is.

## What belongs here

Write a record when a change meets any of these:

- It changes the shape of the database, not just its contents.
- It picks one approach over a reasonable alternative, and the reader will wonder why.
- Undoing it later would cost more than a week.
- It affects how two or more modules talk to each other.

Bug fixes, refactors, and ordinary features do not need one. The pull request description is enough for those.

## How to write one

Copy the structure of an existing record. Number files sequentially, `NNNN-short-title.md`, and never renumber an existing one.

Every record needs, at minimum:

- **Status** — Proposed, Accepted, Superseded by NNNN, or Withdrawn.
- **Context** — what is true today that makes this a decision. Be specific and cite real files and line numbers, not general principles.
- **Decision** — what was chosen, in plain terms.
- **Alternatives considered** — what was rejected and why. This is the section people come back for. A record without it is just documentation.
- **Consequences** — what gets harder, not only what gets better.

A record is reviewed like any other change: open a pull request, discuss it there, merge it when the team agrees. Merging with status `Accepted` is the decision.

## Keeping these current

Records are not living documents. Once accepted, a record describes what was decided at that time and stays that way, even when the code moves on.

When a later decision changes an earlier one, write a new record and set the old one's status to `Superseded by NNNN`. Do not edit the original to match the new reality — the reason a decision was reversed is usually more valuable than either decision on its own.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-multi-tenancy.md) | Multi-tenancy: agencies, client companies, and applications | Proposed |
| [0002](0002-testing-multi-tenancy.md) | Testing the tenancy boundary | Proposed |
| [0003](0003-application-split-is-separable.md) | The candidate/application split is separable from tenancy | Proposed |
