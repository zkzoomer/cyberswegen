# CyberSWE task-builder worker instructions

## Authority and precedence

This file is the factory's user-authored operating policy for a Daytona task-building
worker. Follow it for the whole job.

Instruction priority is:

1. System, developer, platform, tool, and safety instructions.
2. This `AGENTS.md`.
3. The job-specific `JOB.md`.
4. The CyberSWE skill installed by `rv init` and its references.
5. Repository-local contributor documentation.

If this file conflicts with the CyberSWE skill, follow this file. The skill is still
required reading because it contains the detailed Realm file format, test rules, and
authoring workflow. Some of its rollout model names and pass-rate guidance are stale;
the rollout policy in this file is authoritative for this factory.

**This precedence is intentional and absolute for rollout policy.** The generated
`rv init` skill currently contains older guidance involving five Gemini 3.5 Flash runs
plus GLM 5.2, Qwen 3.7 Max, and MiniMax M3. That guidance is outdated for this factory.
Do not copy it into the handoff, do not merge it with this file, do not flag the mismatch
as an uncertainty, and do not replace the policy below after reading the generated skill.
The required lanes are exactly the GPT-6.1 Sol and weak-model lanes stated in this file
unless this `AGENTS.md` itself is deliberately updated by the human controller owner.

Do not reinterpret an approved job as a request to select a different vulnerability.
Candidate discovery, prioritization, and difficulty screening happened on the local
controller before this worker was started.

## Language

Use English exclusively for all progress updates, tool-call explanations, generated task
files, handoff notes, reports, and final status messages. Do not switch languages to match the
repository, advisory, source comments, documentation, or tool output unless `JOB.md` explicitly
requires a non-English artifact.

Keep progress updates concise and framed as defensive local regression work. Do not narrate
step-by-step exploitation, credential abuse, or weaponization in routine commentary when a
short statement of the security property and validation result is enough. Hidden tests,
technical task files, and factual handoff notes may still contain the precise detail required to
reproduce the vulnerability, reject incomplete fixes, and explain the result to the human author.

## Mission

Turn the approved real-world security advisory described in `JOB.md` into a validated
CyberSWE task draft. Perform the technical work autonomously:

- investigate the advisory and upstream repair;
- reproduce the vulnerable behavior at the correct upstream state;
- scaffold the task with `rv init`;
- vendor the vulnerable repository;
- implement a minimal, general gold patch;
- implement hidden fail-to-pass security tests;
- select and protect meaningful pass-to-pass regression tests;
- configure the verifier and Docker environment;
- run the original suite and Realm validation;
- investigate and resolve probe findings;
- package the draft with `rv submit` whenever the task has reached a submit-capable state; and
- place the complete handoff under `/output`.

The target is a task that is roughly 90--95% complete. The intended remaining human
work is:

1. run and review the required Realm model rollouts;
2. rewrite and calibrate the worker-generated draft prompt in the author's own words if
   the genuine pass rate is outside the required band;
3. write `reasoning.txt` in the author's own words;
4. perform the final human review and submission.

Do not upload to Realm, schedule Realm rollouts, publish patches, open pull requests,
or contact upstream maintainers.

## Non-interactive autonomy

The sandbox is disposable and exists for this job. Work without requesting routine
command approval. Use the available filesystem, Docker daemon, network, build tools,
and `rv` commands as needed. Do not pause merely to ask which normal implementation
step to take.

Make conservative, reversible choices when details are not material. Record any assumption the
human must know in `reasoning-notes.md`. If a missing human decision would materially change the
vulnerability, threat model, approved scope, or expected security property, stop task mutation
but still create the recovery handoff required by the durability contract below. Never exit and
leave completed work only inside the disposable sandbox.

Never expose, print, persist, copy into Git, or package credentials. Treat environment
variables, Daytona secret placeholders, OpenAI credentials, and registry tokens as secrets.
Do not include them in commands whose output is captured.

## Inputs

Read `/home/daytona/workspace/JOB.md` first. It provides the approved security advisory URL,
the Realm task ID to write into `metadata.task_id`, and the exact fixed author metadata. A job
may also contain one short `Approved focus` value when the advisory describes several independent
vulnerabilities. Derive the repository, commits, instance ID, fix source, and other technical
details from primary upstream sources.

Use the assigned task ID from `JOB.md` exactly. The controller requires it before creating the
sandbox, so it is never a placeholder. Never invent another value, use `0`, leave the field
empty, or replace the supplied ID.

Do not treat omitted technical fields as a reason to wait for input. The one exception is an
advisory containing several independently exploitable flaws where the approved task cannot be
identified from the link alone. In that case, do not bundle the flaws or choose one silently;
record that the job needs an `Approved focus` value.

## Initialize the task correctly

Derive the instance ID from the primary upstream source using this exact shape:

```text
<organization>-<repository>-<advisory-identifier>
```

Lowercase every component, retain only letters, digits, and hyphens, and collapse other
separators to one hyphen. Use the canonical identifier from the approved advisory, including
its prefix, for example:

```text
bytecodealliance-wasmtime-ghsa-2hw9-mc66-jc2q
cosmos-evm-cve-2026-1234
rkyv-rkyv-rustsec-2026-0235
```

Do not append a symptom slug, task ID, timestamp, or random suffix. The task directory and
`instance_id` must use this exact value. Initialize it with the installed CLI:

```bash
rv init <organization>-<repository>-<advisory-identifier> --realm cyberswe
```

Because `rv submit` names its archive from the task directory, this also makes the normal
submission archive `<organization>-<repository>-<advisory-identifier>.zip`. Do not rename or
rebuild that archive.

Set the task author metadata to:

```toml
authors = [{ name = "Sergio Martinez", email = "sema8047@expert.micro1.ai" }]
```

This exact value is also repeated in `JOB.md`. Do not substitute another name or email. Set
`metadata.task_id` to the exact positive integer supplied by `JOB.md`.

Do not hand-build the Realm directory structure. After initialization:

1. read the generated `.agents/realm-cyberswe-authoring/SKILL.md` completely;
2. read its `references/prompt-calibration.md` before making any prompt-difficulty
   assessment;
3. inspect any other directly referenced file needed for the current stage; and
4. continue to follow this file where the generated skill is outdated or conflicts.

Use the current Realm-generated filenames and layout. In particular, preserve the
linked environment/verifier layout created by `rv init`; do not duplicate repositories
or hidden tests into extra directories.

## Establish the real vulnerable base

The task must represent a real published vulnerability, not an invented or artificially
seeded bug.

1. Read the advisory, fixing commit, fixing PR, related issue, release notes, and relevant
   discussion from primary sources.
2. Identify the last genuinely vulnerable upstream commit or the exact vulnerable commit
   specified by the job.
3. Verify the repository license is accepted by Realm and keep the root license file.
4. Clone or check out the vulnerable source into `environment/repo/` with enough readable
   upstream history for Realm's repository-history checks, but do not fetch the entire
   upstream object graph by default. Prefer a bounded, filtered checkout:
   ```bash
   git init environment/repo
   git -C environment/repo remote add origin <upstream-url>
   git -C environment/repo fetch --depth=100 --filter=blob:none origin <base-commit>
   git -C environment/repo checkout --detach FETCH_HEAD
   git -C environment/repo gc --prune=now
   ```
   If the host will not fetch the commit by object ID, fetch only the branch or tag containing
   it, still with bounded depth. Do not fetch all branches, tags, pull-request refs, or a full
   history merely for convenience. Verify that `git rev-list --count HEAD` reports at least ten
   genuine readable commits. Preserve this bounded `.git` directory in the task source.
5. Record the upstream repository, exact base commit, affected release, fix source, and
   license briefly in `reasoning-notes.md`.
6. Run the repository's relevant original tests before adding the security tests.

The vulnerability must be silent against the original suite. A broken existing test that
directly reveals the answer makes the task invalid or leaks the localization. Repair the
task construction rather than deleting or weakening legitimate tests.

The task source and the evaluator image have different history requirements. Keep the bounded
genuine upstream history in the vendored `environment/repo/` authoring tree, as required by the
CyberSWE MasterDoc. Add `repo/.git` to `environment/.dockerignore` so authoring-only Git metadata
and scratch worktrees do not invalidate the expensive Docker repository-copy layer. The
evaluator must not expose that history to the solving agent: follow the generated Dockerfile
pattern that copies the working tree into `/app`, removes the copied `.git` metadata there, and
creates a flattened initial commit. Do not leave fixing commits, advisory patches, changelogs
that directly reveal the repair, duplicate fixed files, build artifacts, or cached dependencies
in the agent image.

## Scope: one issue or one connected exploit chain

Keep the approved scope fixed. The task may cover multiple code locations only when they
are manifestations of one security invariant or necessary stages in one connected exploit
chain with one impact.

Independently exploitable flaws that each remain vulnerabilities without the other belong
in separate tasks. Do not bundle them merely because they share an advisory, CWE, package,
or impact.

For every path included in the task, be able to state in the factual handoff notes:

- the public attacker-controlled entry point;
- the trust boundary crossed;
- the incorrect state, authorization, identity, parsing, or execution decision;
- the observable security sink; and
- why each tested path is part of the same issue.

If evidence shows the approved scope is actually several independent vulnerabilities,
stop task mutation and mark the job `blocked_scope` rather than silently redefining it. Preserve
the complete current task directory and evidence in a recovery handoff ZIP before exiting.

## Gold patch requirements

Derive the gold patch from the real upstream remediation and the security invariant, not
from the hidden fixtures alone.

The gold patch must be:

- production code only;
- minimal in logic and scope;
- general across equivalent attacker-controlled inputs;
- consistent with upstream architecture and style;
- free of unrelated refactors, formatting churn, generated residue, dependency updates,
  feature rewiring, or test changes unless technically necessary; and
- sufficient to close the full approved vulnerability, including rollback, error, alternate
  algorithm, alternate entry point, or state-transition paths that share the invariant.

Comments that explain non-obvious security reasoning are acceptable, but comments must not
replace necessary logic. Regenerate required mocks or generated production interfaces when
the production change requires them; the complete repository must still build.

Construct edits in a scratch working copy and generate `solution/gold_patch.diff`
mechanically with Git. Never manually edit unified-diff hunk counts. The pristine vendored
base must remain the base state.

Check the gold patch with:

```bash
git apply --check solution/gold_patch.diff
```

and through the actual oracle workflow.

## Fail-to-pass security tests

Every F2P test must fail for the vulnerable base for the intended security reason and pass
after the gold patch.

F2P tests must:

- enter through the real public or production-facing surface an attacker can reach;
- reproduce realistic malicious behavior without directly invoking a private helper solely
  to manufacture the bug;
- assert the security outcome at the sink, not that a particular helper or patch mechanism
  was used;
- be deterministic and independent of wall-clock time, randomness without a fixed seed,
  live services, public networks, or external signing infrastructure;
- include representative variations that defeat obvious payload-specific special cases;
- cover every branch needed to close the approved vulnerability;
- reject realistic partial fixes observed in upstream history, probe output, or alternative
  reasoning;
- allow a different correct defense at another layer; and
- use the framework's real test conventions.

Each F2P test needs an accurate documentation comment or docstring covering:

- **What:** the security property being checked;
- **How:** how the fixture reaches the vulnerable behavior;
- **Why:** why the observable assertion closes the reported attack; and
- **Alignment:** why the assertion is at the public security sink rather than tied to the
  reference implementation.

Give every newly added hidden test file an unguessable name component, preferably at least
16 random hexadecimal characters. Conventional names and short five-character suffixes are
not sufficient.

Keep tests in `tests/test_patch.diff`, not in the agent-visible base. Generate the patch
mechanically. Do not leak the advisory, fix, exploit, or expected implementation through
comments in the starting repository.

For inline-test languages, relocate every graded inline test into a dedicated protected test
file using the repository's supported module/test layout. Leaving a small module declaration
in production source is acceptable when required by the language. Do not copy large trees or
duplicate source files merely to protect tests.

## Pass-to-pass regression tests

P2P tests prove that a security repair did not destroy legitimate behavior. They are not
padding and must not encode obsolete vulnerable behavior.

Select existing tests that cover:

- the benign form of every attacked public flow;
- the packages and public entry points changed by plausible repairs;
- adjacent state, rollback, error, serialization, authorization, identity, and integration
  behavior;
- successful and ordinary failure paths; and
- broader repository behavior sufficient to catch a patch that disables or guts the module.

Realm requires at least 15 meaningful regression IDs; 100 is an aspirational target, not a
reason to manufacture work. Select the smallest meaningful regression net that protects the
changed public behavior. Prefer already-separate integration and package tests. Do not relocate
large inline test modules, copy large files, or add unrelated tests merely to reach 100 IDs.
Widen coverage only when the gold patch changes a central execution path or concrete evidence
shows that the current regression boundary is too narrow.

Finalize the graded F2P/P2P set and protected-file layout before the first oracle run. At that
point every listed ID must be exact and parsed, every graded file must be protected, and every
required inline-test relocation must already be complete. After oracle begins, do not widen or
relocate the suite merely to improve the test count; change it only for a concrete correctness,
fairness, or probe finding.

Every listed P2P ID must:

- actually be executed by `test_cmd`;
- be emitted and parsed exactly by the configured parser;
- pass on the vulnerable base; and
- pass after the gold patch.

As required by the CyberSWE MasterDoc, copy the complete existing repository test file that
contains each graded P2P test into `tests/test_patch.diff`, preserving its repository-relative
path. Do this even when the worker did not edit that test file. Cover every such complete file
with `protected_paths`, and never include a production file changed by the gold patch merely to
protect an inline test; relocate graded inline tests into a dedicated supported test file first.

Do not classify a correct alternative fix as wrong merely because it changes an internal
implementation detail. P2P assertions should protect observable behavior, state, outputs,
events, errors, and gas/resource semantics that are genuine contracts.

## Test fairness and grading fairness

The verifier must accept correct solutions and reject incomplete ones.

### Avoid overspecification

Do not require:

- the exact upstream function, helper, field, cache, data structure, or call count;
- a particular error string unless the wording itself is a documented API contract;
- the exact gold-patch file set;
- internal reflection over a helper signature;
- a specific ordering that has no externally observable consequence; or
- an implementation-only side effect.

Keep assertions behavioral so a different correct repair can pass. Do not spend the draft phase
implementing speculative alternative repairs before probes; alternative-solution probes are
responsible for finding concrete competing approaches.

### Avoid underspecification

Test realistic incomplete repairs, including as applicable:

- checking only one identifier representation;
- deduplicating by the wrong identity;
- repairing success but not rollback or error paths;
- repairing ordinary errors but not out-of-gas or cancellation;
- fixing one public wrapper while leaving an equivalent wrapper vulnerable;
- validating one algorithm, curve, key type, encoding, archive format, or stateful
  precompile but not its peers;
- synchronizing storage but losing events, or restoring events while stale storage is still
  committed;
- special-casing the exact exploit fixture;
- rejecting all suspicious operations and thereby breaking legitimate behavior; and
- changing a test-visible internal detail without restoring the security invariant.

Cover incomplete fixes already evident from the advisory, upstream repair, or repository design.
Do not pre-build a catalogue of speculative partial patches before probes. When a probe produces
a concrete partial repair, use that evidence to decide whether one focused test is missing.

### Separate real model failures from grading defects

A model failure is meaningful only when the model had enough symptom information to locate
the issue and its patch is security-incomplete or engineering-incorrect. A failure caused by
a misleading prompt, missing requirement, broken environment, unparseable test, gold-specific
assertion, or obsolete P2P expectation is a false fail and must be corrected.

A passing patch still requires review. Check that it did not special-case the fixtures,
disable functionality, modify graded tests, or leave an equivalent attack path open.

## Verifier configuration and protection

Configure `tests/config.json` precisely:

- `fail_to_pass` is non-empty and contains exact parsed IDs from hidden tests;
- `pass_to_pass` contains exact parsed existing regression IDs;
- `test_cmd` runs every listed test and prints its result where the parser can read it;
- `log_parser` returns stable, unique IDs; and
- `protected_paths` covers every graded F2P and P2P test file with exact paths or narrow
  globs.

Protected paths must not overlap production files changed by the gold patch. Protect complete
graded test files so an agent cannot weaken them. Audit non-Python frameworks manually even
when `rv check` attempts automatic coverage validation.

The verifier applies the filtered agent patch first and `tests/test_patch.diff` second. Ensure
that both apply cleanly to the pristine base and that hidden tests are absent from the agent
image.

## Draft the instruction only after understanding the complete task

Do not write `instruction.md` when first reading `JOB.md` or immediately after `rv init`.
The prompt is an output of the security analysis, not an input to it. First complete all of
the following:

1. read the advisory and primary upstream fix material;
2. establish and test the real vulnerable base;
3. define the single vulnerability or connected exploit chain precisely;
4. understand the public entry point, trust boundary, root cause, attack mechanism, and
   observable security sink;
5. derive and verify the complete gold repair;
6. implement the F2P exploit coverage and P2P regression boundary;
7. identify plausible correct alternatives and plausible incomplete repairs; and
8. configure the verifier and confirm the tests express the intended security property.

Only after that work is complete, write an initial **draft** `instruction.md` for technical
validation and preliminary Realm rollouts. This is deliberately worker-generated calibration
material, not human-authored submission prose. Add one short reminder in `reasoning-notes.md`
that the human must rewrite the prompt before final submission.

Derive the draft from the verified observable behavior, not from the wording of the advisory,
the upstream patch description, or internal implementation details.

The draft prompt must:

- consist of exactly one short paragraph, normally 20–35 words and never more than 50 words;
- sound like a natural bug report or request written by a real product user, not like benchmark,
  policy, security-review, or task-authoring text;
- contain one observable symptom, one request to investigate and fix it, and at most one brief
  request to preserve directly related normal behavior;
- be as minimal as possible so the first rollouts establish a conservative lower bound on
  model success; additional behavioral clues can be added later if the task proves too hard;
- name no vulnerability class, CWE/OWASP category, root cause, mechanism, file,
  function, class, patch, or hidden test;
- not describe a backend, helper, callback, protocol state machine, internal execution flow, or
  list of exploit variants;
- not prescribe a fix;
- describe the actual observable problem and affected product surface sufficiently to keep
  a reasonable model on the approved issue rather than a different vulnerability in the
  same repository;
- not become misleading merely to reduce the pass rate; and
- ask that normal behavior remain working.

After `rv init`, replace the entire generated `instruction.md` contents with that single
paragraph. Do not retain or add any title, heading, bullet list, numbered list, template note,
"ground rules", anti-cheat footer, evaluation policy, or instructions such as "do not search
the web", "do not inspect history", or "solve only from the files in front of you". Those are
not user symptoms and do not belong in the eval-facing request.

A suitable shape is:

```text
There is an issue with <product surface> where <observable symptom>. Can you investigate and
fix it while keeping <directly related normal behavior> working?
```

Treat this only as a shape, not mandatory boilerplate. Rewrite it so it sounds specific and
natural for the task. For example, the balance symptom discussed during development could be
expressed as: "There is an issue with Cosmos EVM accounts exposing an impossibly large balance
after staking with locked funds. Can you investigate this issue and fix it while keeping normal
staking working?"

Minimal does not mean cryptic. A prompt is defective when its wording naturally points to
another bug, withholds the observable symptom that distinguishes the approved issue, or
requires behavior that only the hidden tests reveal. Add the smallest symptom-level detail
needed to disambiguate the issue, but never add localization or repair clues merely to make
models pass.

Internally draft three candidate prompts and retain the shortest one that is still accurate and
not misleading. Do not include the discarded candidates in the handoff.

Before accepting the draft, compare it against the finished F2P/P2P behavior and ask:

- Does every behavior graded by the verifier reasonably follow from this symptom report?
- Could a capable agent reasonably interpret the wording as a different bug in this repo?
- Did the wording accidentally reveal a code location, mechanism, or repair?
- Is any sentence present only to steer models toward the gold patch?
- Can anything be removed without making the prompt misleading?
- Would an ordinary user plausibly know and use every technical term in it?

## Draft and human-authored files

The worker may generate the initial draft `instruction.md` used to validate and calibrate the
task. The final submitted `instruction.md` and `reasoning.txt` remain human-authored files.
Never describe the worker draft as final or submission-ready prose.

- Write the shortest fair, symptom-only, non-misleading draft prompt into `instruction.md`.
- Ensure the file contains only one natural-language paragraph with no heading, ground rules,
  anti-cheat text, or other meta-instructions.
- Do not label its worker-generated status inside the prompt itself; the eval-facing prompt must
  still read like an ordinary bug report.
- Require the human author to rewrite and take responsibility for it before final submission.
- Set `reasoning.txt` to exactly:

  ```text
  [TODO -- fill up]
  ```

- Write `reasoning-notes.md` as factual engineering notes for the author. Use concise bullets,
  code references, test IDs, observed behavior, and evidence. It must not be presented as final
  submission prose.
- Write `draft-proposal.txt` only after the task scope, gold patch, tests, and validation results
  are understood. It is a short handoff draft for the human to review and rewrite, not a file
  included in the nested Realm task archive.

Reasoning-specific lint or judge complaints caused solely by the required placeholder
are expected at this draft stage. Record and ignore only those complaints. Never ignore
another check merely because it appears beside a reasoning complaint.

## Docker and resource discipline

Use the Realm Dockerfile generated by `rv init` as the starting point. It must copy only the
agent-visible repository and development dependencies needed to work on it. Never copy
`tests/`, `solution/`, hidden fixtures, or author-only artifacts into `/app`.

The authoring worker may use network access to research primary sources and fetch build
dependencies. That permission does not authorize changing the CyberSWE task's Harbor/verifier
network mode. Keep the network mode created by `rv init` unchanged, and make the verifier and
graded tests deterministic without relying on live external services. Use local fixtures,
mocks, fakes, or recorded inputs for remote behavior.

The Daytona worker has a 10 GiB writable filesystem. Keep it below 90% utilization:

- honor `M1_BUILD_JOBS=2`;
- set ecosystem concurrency to two where needed;
- serialize memory-heavy package suites when parallel execution can OOM;
- inspect `df -h /`, task-directory sizes, and Docker usage at meaningful stage boundaries,
  not repeatedly while a known build is still running;
- keep build and dependency caches through validation and submission when disk space permits;
  remove only obsolete trial jobs, extracted scratch copies, and superseded Docker layers while
  the task is still being built;
- keep one pristine base and only the minimum active scratch copies; and
- never package `target`, `node_modules`, `.venv`, build trees, downloaded archives, trial
  jobs, or unmanaged QC scratch data. Preserve Realm's curated `qc_artifacts/` for `rv submit`.

Do not make source-code changes solely to work around worker resource limits. Prefer test
command serialization, build flags, or Docker environment settings.

Before the first compilation, configure task-external build and dependency caches and reuse
them across the pristine base, gold scratch tree, and candidate worktrees. For Rust, set one
absolute `CARGO_TARGET_DIR` outside the task directory; for Go, reuse external build/module
caches; for Node and other ecosystems, reuse the package manager's download and compiler caches.
Do not put these caches in the task archive or expose host-specific cache paths through verifier
configuration.

Never run `cargo clean` or the ecosystem's equivalent as routine hygiene, before oracle, before
probes, or before `rv submit`. Clear a cache only after concrete evidence of corruption or a
measured disk-space emergency. If cleanup is unavoidable, remove the narrowest obsolete cache
or artifact rather than invalidating the complete dependency graph. Task-external caches can be
removed after the verified handoff ZIP has been downloaded.

For repositories with a large compiled dependency graph, prewarm compilation in the evaluator
image after dependencies are installed but before validation begins. Use the ecosystem's
compile-only or no-tests-executed mode so this does not run hidden tests, alter product behavior,
or copy author-only files into the image. The goal is to bake reusable dependency and compiler
artifacts into an immutable Docker layer so each isolated verifier or probe does not rebuild the
same third-party graph from scratch.

Choose the narrowest prewarm that covers the packages used by `test_cmd`. Examples include:

- Go: `go test -run '^$'` for the relevant packages after `go mod download`;
- Rust: `cargo test --no-run` for the relevant package or workspace subset;
- C/C++: configure and compile the relevant test targets without executing them;
- Java/Kotlin: compile the relevant test source sets without running the test task; and
- other ecosystems: use their equivalent dependency-fetch plus compile-only operation.

For example, a heavy Go task may use a task-specific Dockerfile step such as:

```dockerfile
RUN go test -tags=test -run '^$' -p="$M1_BUILD_JOBS" \
      ./path/to/relevant/package ./path/to/another/package \
 && cd secondary-module \
 && go test -tags=test -run '^$' -p="$M1_BUILD_JOBS" \
      ./path/to/relevant/integration/package
```

The paths, tags, and commands must come from the repository and final verifier configuration;
do not copy this example literally. Keep the resulting cache in the image through all dynamic
checks and probes. Do not clear ecosystem build or module caches until validation is complete
unless a measured disk limit makes cleanup necessary.

## Fast validation workflow

This worker is producing a draft for difficulty testing, not conducting the final human review.
Avoid duplicated validation and freeze the test layout before expensive Realm work. Use this
order exactly:

### Pre-oracle viability budget

Record the wall-clock time when substantive task construction begins. Check the elapsed time
only at natural stage boundaries and after a build failure; do not add another polling loop.

- If the task has not produced a green `rv oracle` within 60 minutes, stop construction. Do not
  start probes, another oracle, another full rebuild, or further test redesign.
- If a focused build or link is killed by OOM, allow exactly one resource-safe retry using
  build configuration only, such as lower parallelism, serialized targets, reduced debug data,
  or a lower-memory linker. Do not change product source to accommodate the worker.
- Stop immediately if that retry also fails, remains unable to complete within the remaining
  60-minute pre-oracle budget, or would require another multi-gigabyte cache deletion and cold
  rebuild.

When this gate triggers, preserve the current task directory and produce the normal recovery
handoff ZIP with the work-in-progress archive and a concise `failure-summary.md`. State the
elapsed time, last proven base/gold behavior, failed build or oracle stage, resource evidence,
and remaining work. Do not run probes or `rv submit`, and never exit without the verified
recovery ZIP under `/output`.

1. Run the narrow focused upstream tests needed to prove the final base/gold split. Finish the
   F2P/P2P IDs, parser, test commands, protected paths, hidden-test files, and any unavoidable
   inline-test relocation now. Expect no routine test-layout or configuration changes afterward.
2. Run only cheap structural and static Realm checks. Do not run dynamic validation, probes,
   LLM judgment, or a full `rv check` at this stage. Fix mechanical task-shape problems before
   spending time on image builds.
3. Run `rv oracle` once and require reward 1.0. Do not run another standalone or packaged-copy
   oracle after it passes.
4. Run the complete probe stage once so gameability, alternative-solution, and leakage start
   together with OpenRouter GLM 5.2.
5. If one category reports a real finding, inspect sibling variants at the same trust boundary,
   make one class-wide correction, run the narrow focused base/gold proof, and rerun only that
   affected category once. Never rerun categories that were already clean. If the targeted
   rerun finds another gap, stop probe-driven refinement, record the unresolved finding and
   exact evidence in `validation-summary.md`, and continue to submission. Do not make a second
   correction or launch a third probe attempt in that category.
6. Run one final `rv check` with the probe stage excluded. Resolve actionable non-reasoning
   findings without rerunning oracle or the already-clean probe categories.
7. Run `rv submit` normally. Its deterministic gate is the final packaging check. Do not run a
   fresh-extraction oracle or another full `rv check` afterward.

If a probe finding is disproved and causes no task change, do not rerun it; explain the concrete
source, reachability, or focused-test evidence in `validation-summary.md`. Exhausting the probe
budget must never discard the task or prevent a ZIP from being returned.

Use `rv check --help` and `rv probe --help` only to obtain the installed command syntax. Do not
experiment with several equivalent command combinations. Do not use `--no-cache` unless a result
is demonstrably stale or corrupt. Keep language and Docker build caches through submission.

For a yielded long-running command, wait on that same process or session instead of launching
duplicate commands. Quiet compilation and probes are not themselves evidence of a hang. Perform
at most one health check after 15–20 minutes with no new output, and inspect the existing process
or log once. Do not repeatedly poll `ps`, Docker statistics, job directories, disk usage, or the
same log unless that check reveals a concrete resource or infrastructure problem.

Do not treat a green oracle as proof that the task is fair. The probes provide the fast fairness
and gameability review for this draft.

## Probe policy

Run all three probe categories together for the initial attempt:

```bash
RV_PROBE_AGENT=opencode \
RV_PROBE_MODEL=openrouter/z-ai/glm-5.2 \
RV_PROBE_TIMEOUT_SECONDS=1800 \
rv check --stage probes \
  --llm-backend openrouter --judge-model z-ai/glm-5.2
```

This initial command starts gameability, alternative-solution, and leakage in the same probe
stage. Review each resulting report independently.

If a real finding causes a task change, rerun only that affected category using `--check`:

```bash
RV_PROBE_AGENT=opencode \
RV_PROBE_MODEL=openrouter/z-ai/glm-5.2 \
RV_PROBE_TIMEOUT_SECONDS=1800 \
rv check --check cyberswe/probe-gameability \
  --llm-backend openrouter --judge-model z-ai/glm-5.2
```

Replace the check name with `cyberswe/probe-altsolve` or `cyberswe/probe-leakage` when that is
the category that caused the change. Never rerun the complete probe stage merely because one
category changed.

The controller installs the OpenRouter key at runtime in the disposable sandbox. Never display,
copy into the task, or package that credential. Do not add `--no-cache` routinely; use it only
when there is concrete evidence of a stale or corrupt cache.

Do not rerun a probe because its report is shallow, ambiguous, inconvenient, or differently worded
than expected. After the first confirmed finding, inspect sibling variants at the same trust
boundary and make one class-wide correction before rerunning only that category. If that single
targeted rerun finds another gap, stop automated probe refinement: make no more probe-driven task
changes, document the current unresolved finding in `validation-summary.md`, and finish
`rv submit` plus the normal outer handoff ZIP. The refinement limit is not a terminal job state
and never authorizes returning a Markdown file instead of the ZIP. Every non-infrastructure
rerun requires a concrete task change. If category C causes a change, rerun C only; never rerun
already-clean categories A and B.

Do not stop merely because a probe is inconvenient, but do not modify a fair task to appease a
probe that demands a particular internal implementation or an impossible attacker path. Record
the exact finding, candidate patch, focused test result, and reason for accepting, fixing, or
disputing it in the final validation evidence.

Assess a probe candidate with the single implicated F2P/P2P or the narrowest relevant package
test. Do not run a candidate through a standalone oracle or full verifier merely to understand
the finding.

### Preserve Realm QC and probe artifacts

`rv check` and `rv probe` write their curated reports under `qc_artifacts/`, and normal
`rv submit` includes that directory in the submitted task ZIP. Preserve the current official
reports for the human and reviewer. Never delete, move outside the task, or replace those
reports before the final `rv submit`; remove only superseded or manually copied investigation
artifacts as described below.

After every check or probe, confirm its report is present under `qc_artifacts/` and keep only the
latest official report for each category. Do not create a separate validation summary for clean
reports or ordinary actionable findings that were fixed within budget. Create
`validation-summary.md` only when a probe makes a misleading or non-applicable finding that the
human needs explained, or when the bounded probe-refinement budget ends with a real unresolved
finding. Keep it narrowly scoped as defined below.

Raw Harbor `jobs/`, repository copies, Docker layers, dependency/build caches, and credentials
are not the curated QC record and may be removed before submission. Do not manually copy
candidate `agent_patch.diff` files, candidate fix diffs, superseded probe reports, raw
transcripts, verifier logs, or other job output into `qc_artifacts/probes/`. Those are
investigation material, not final task artifacts. If a short fact learned from a candidate is
needed, summarize it in `reasoning-notes.md` or, for a disproved probe finding,
`validation-summary.md`. The final nested task ZIP must contain `qc_artifacts/` with the current
official probe reports and no manually preserved candidate evidence.

Use OpenRouter `z-ai/glm-5.2` for every probe. Do not substitute another model. Infrastructure
failures, policy refusals, timeouts, OOM kills, missing sandboxes, and provider 5xx errors are not
task findings; preserve the generated QC result and continue rather than starting a retry loop.

Expected complaints about the exact `[TODO -- fill up]` contents of `reasoning.txt` may be
recorded without remediation during draft construction. All other probe and `rv check`
findings require evidence-based handling.

## Current Realm rollout policy for the human handoff

Do not run these Realm rollouts from the worker. Record the following current policy in the
handoff. **This section is the sole source of truth for rollout models and pass-rate bands.**
It overrides every conflicting rollout instruction in the generated CyberSWE skill. In
particular, ignore its Gemini 3.5 Flash / GLM 5.2 / Qwen 3.7 Max / MiniMax M3 directions;
those directions must not appear in the handoff.

### Weak-model lanes

The author runs one rollout each:

- GPT-6 Luna;
- DeepSeek v4.1 Flash; and
- GLM 5.3 Flash.

At most one of these three may be a genuine pass. Review patches, not raw rewards.

### Frontier lane

The author runs eight GPT-6.1 Sol rollouts. Between one and five must be genuine passes.

In the rare case that GPT-6.1 Sol produces zero genuine passes, the task may still demonstrate
solvability if all other requirements remain satisfied and either:

1. one weak-model rollout genuinely passes while the weak lane remains at no more than one
   genuine pass out of three; or
2. a genuine pass is obtained from GPT-6 Astra, Opus 5.5, or Fable 5.1.

Do not describe raw `100%` rewards as genuine passes without reviewing the patch. Separate:

- true passes;
- true fails caused by incomplete or wrong security reasoning;
- false passes caused by verifier gaps;
- false fails caused by overspecification or missing prompt requirements; and
- infrastructure/policy failures.

Any task or prompt change creates a new task version and requires fresh rollouts for the final
version.

## Prompt calibration notes for the human

The initial worker-generated draft prompt should be the shortest non-misleading symptom report
that identifies the affected product surface. Starting minimal establishes a lower-bound pass
rate because symptom-level clues can be added later if genuine frontier pass rate is zero.
Never make the prompt cryptic, ambiguous, or naturally suggestive of a different repository
issue merely to force failures.

When the pass rate is too low, distinguish:

- models that reach the correct subsystem and make incomplete fixes: valid difficulty;
- models that consistently repair a different issue because the symptom fits several known
  bugs: misleading prompt;
- models that identify the right invariant but lack one required behavior never stated or
  inferable from the repository: missing requirement; and
- policy/provider failures: infrastructure, not difficulty.

Add only behavioral information needed to identify the real symptom or required invariant.
Do not name the root cause, file, function, data structure, or repair. When the pass rate is
too high, remove unnecessary clues; do not manufacture new requirements or overfit tests to
lower scores.

## Packaging and submission draft

### Use `rv submit` normally

Realm owns the task archive format. Run `rv submit` normally from the canonical task directory
and use the ZIP it produces without renaming, rebuilding, filtering, or manually reproducing its
contents. Do not create temporary symlinks around Realm directories and do not pre-delete files
that `rv submit` normally captures.

In particular, `qc_artifacts/` is authored submission evidence, not disposable residue. Keep it
in the task when `rv submit` runs. Raw `jobs/`, language build outputs, dependency caches, and
scratch worktrees remain disposable and should be cleaned separately.

Before packaging:

- ensure the vendored base is pristine;
- ensure `solution/gold_patch.diff` contains only necessary production changes;
- ensure `tests/test_patch.diff` contains complete hidden tests and applies cleanly;
- ensure protected paths cover every graded file and do not overlap gold production files;
- ensure the original suite, base split, oracle, and relevant probes have completed;
- confirm `qc_artifacts/` contains the final check and probe reports and leave that directory in
  the task for `rv submit`;
- remove build/dependency residue, task trial jobs, temporary run artifacts, and accidental
  downloaded archives;
- scan the entire canonical task tree, not only `environment/repo/`, and remove Python bytecode
  and cache residue such as `__pycache__/`, `*.pyc`, and `*.pyo`;
- ensure `qc_artifacts/probes/` contains no candidate diffs, superseded reports, or manually
  copied job artifacts;
- inspect the archive file list for secrets, duplicate repositories, hidden tests in the
  environment, upstream history, and bloat; and
- verify the archive from a fresh extraction.

Use `rv submit` to generate the draft archive. Do not invent a replacement packaging format.
If `rv submit` refuses solely because `reasoning.txt` intentionally contains the placeholder,
record that as the packaging blocker and preserve the otherwise complete source tree in a
recovery handoff ZIP for the human. Never misrepresent a substantive validation failure as a
clean completed task merely to produce a normal submission ZIP. This does not authorize
discarding work: preserve a non-submit-capable task in the recovery handoff ZIP defined below.

The draft archive is not ready for final Realm submission until the human has written and
reviewed `reasoning.txt`, confirmed the prompt is their own prose, and completed rollout
analysis.

## Required output contract

### Hard durability invariant

Every worker run that created or modified task work must return exactly one downloadable ZIP.
No scope blocker, probe result, failed check, failed `rv submit`, build error, agent-observed
timeout, or other terminal condition may leave the only copy inside the disposable Daytona
sandbox. A long-running job returning no work is never an acceptable outcome.

There are only two permitted handoffs:

1. **Normal draft handoff:** the task reached `rv submit`; return
   `/output/<instance-id>-draft-handoff.zip` in the normal format below.
2. **Recovery handoff:** a condition outside the bounded normal workflow prevented `rv submit`
   or prevented a valid normal handoff; return
   `/output/<instance-id>-recovery-handoff.zip`. This is explicitly non-submittable and exists
   only so the human can resume instead of losing the work.

Probe-refinement budget exhaustion by itself is not a recovery condition. Stop refining, document
the unresolved finding, run `rv submit`, and return the normal draft handoff. Use recovery only
when normal submission genuinely cannot be produced.

Before any terminal response, clear stale files from `/output`, create the appropriate one ZIP,
list and verify its contents, compute its SHA-256, and confirm it is the only `/output` entry.
Do not print a final response until that verification succeeds.

The normal final deliverable is one outer ZIP and nothing else. Name it clearly from the instance
ID, for example `/output/<instance-id>-draft-handoff.zip`.

The outer ZIP normally contains exactly three files at its root:

```text
<instance-id>-draft-handoff.zip
  <instance-id>.zip
  reasoning-notes.md
  draft-proposal.txt
```

Add `validation-summary.md` as a fourth file only when a probe produced a misleading or
non-applicable finding that requires a short explanation, or when the bounded refinement budget
ended with a real unresolved finding requiring human review. Do not create it for clean probes,
ordinary fixed findings, command versions, test counts, or routine status reporting.

`<instance-id>.zip` is the actual nested CyberSWE archive produced by `rv submit`. Its basename
must be the canonical `<organization>-<repository>-<advisory-identifier>` value. Do not
replace it with an ordinary ZIP of the working directory and do not add another directory
wrapper around these files. Before wrapping it, inspect the nested archive and confirm that
the `qc_artifacts/` produced by `rv check` and `rv probe` are present.

### Recovery handoff format

A recovery handoff contains exactly:

```text
<instance-id>-recovery-handoff.zip
  <instance-id>-work-in-progress.zip
  failure-summary.md
```

`<instance-id>-work-in-progress.zip` preserves the entire current task directory needed to resume,
including source, tests, solution files, current `qc_artifacts/`, and authoring metadata. Exclude
credentials, raw `jobs/`, build outputs, dependency caches, Docker data, Python bytecode, and other
reproducible residue. `failure-summary.md` records the exact stopping condition, completed stages,
current failing command or finding, remaining work, and whether `rv submit` was attempted. Never
call this archive a completed or submittable task.

Do not include the unpacked task source, dependency trees, compiler outputs, Docker data,
repository clones, complete trial-job directories, credentials, or any other file in the outer
ZIP. Curated `qc_artifacts/` belong inside the nested task ZIP produced by `rv submit`; do not
strip them and do not substitute an unfiltered copy of `jobs/`.

### `reasoning-notes.md`

Write it in simple, concrete language so the human can understand the whole task and
independently write `reasoning.txt` using the exact
template generated by `rv init`. Do not assume the human remembers the advisory or code.

Follow the generated reasoning template section by section and provide all underlying facts:

- **Attack Vector:** numbered attacker steps from public entry point to security sink; what
  the attacker controls; what the system does incorrectly; concrete impact; and the exact F2P
  test or tests demonstrating each step or path.
- **Root Cause:** the most appropriate CWE and/or OWASP classification; exact files,
  functions, fields, expressions, state transitions, or trust decisions involved; and a plain
  explanation of why the vulnerable behavior occurs.
- **Connected scope:** when several locations are involved, explain why they are stages or
  manifestations of one invariant rather than unrelated vulnerabilities.
- **Fix rationale:** what every logical gold-patch change does, why each part is necessary,
  and how the complete repair restores the security invariant without breaking legitimate
  behavior.
- **F2P coverage:** every hidden test ID, its setup, the attack or partial repair it catches,
  why it fails on base, why it passes on gold, and why its assertion is at the public security
  sink.
- **P2P coverage:** the important regression groups, the legitimate behavior they preserve,
  and why disabling or over-rejecting functionality cannot pass.
- **Alternatives considered:** only realistic incomplete repairs. For each, explain why it
  looks reasonable, the exact remaining bypass or incorrect behavior, and the specific F2P
  test that rejects it.
- the advisory, repository, base commit, fix source, and license; and
- a short reminder that `instruction.md` is a worker draft that the human must rewrite.

Prefer examples, concrete before/after values, and short explanations over jargon. These are
teaching notes, not paste-ready final prose; the human must understand and rewrite the final
reasoning independently.

### `draft-proposal.txt`

Write a 150–220 word draft in very simple, concrete language. Count the whole file, including
the field labels. Do not add headings, bullets, caveats, authoring commentary, or material not
supported by the task. Use exactly this structure:

```text
Vulnerability type: [choose the single most applicable type from: Access Control, Auth Session, Crypto, Deserialization Integrity, Error Conditions Race, Injection, Input Validation, Memory Safety, Request Forgery, Secrets Exposure]

CWE classification: [CWE identifier and name]

Repository: [Repository GitHub URL] ([License] license). Source/reference: [GitHub advisory, vulnerability disclosure, or other public primary link]

[Project name] is a [brief description of what the project does and its real-world use].

Issue: [Explain what the affected component is supposed to do and what goes wrong]. An attacker can [explain how the vulnerability can be triggered], causing [specific security impact, such as unauthorized access, memory corruption, stolen funds, or denial of service].

Difficulty: Fixing this requires understanding [the relevant components and how they interact]. A correct fix must [explain what needs to be preserved or handled], while avoiding incomplete solutions such as [one or two realistic partial fixes].

Testing: Local tests will [describe how the vulnerable situation is reproduced using real project functionality]. The vulnerable version should [describe the incorrect behavior], while the fix must [describe the expected secure behavior].

The gold patch is derived from [upstream fix URL, with a short explanation if only part of the upstream fix is used].
```

Before packaging, mechanically validate `draft-proposal.txt`:

- each required label appears exactly once;
- the labels appear in this exact order: `Vulnerability type:`, `CWE classification:`,
  `Repository:`, `Issue:`, `Difficulty:`, `Testing:`, and `The gold patch is derived from`;
- the total length is 150–220 words; and
- no replacement headings or alternative labels are present.

Correct every actionable failed check before running `rv submit`, except a probe finding left
explicitly under the bounded refinement rule above; document that finding and continue to the
normal draft handoff.

Choose the vulnerability type by the security boundary and impact, not merely by the programming
language or affected package. Name a specific CWE supported by the root cause. Use the real
repository, advisory, license, and upstream-fix links; never invent a URL. Describe the tested
attack and realistic incomplete repairs rather than making a generic difficulty claim.

When `validation-summary.md` is required for a misleading finding, include only why it does not
apply, the concrete code, reachability, or focused-test evidence supporting that verdict, and
confirmation that it caused no task change. When the automated probe-refinement budget is
exhausted with a real unresolved finding, instead record the exact remaining false pass or false
fail, the candidate approach involved, the tests it passed or failed, the corrections already
attempted, and that the human must review or strengthen the draft before Realm rollout testing.

Build the outer ZIP after the task ZIP, reasoning notes, and draft proposal are final. Require
exactly those three files, plus the optional narrowly scoped validation summary when applicable.

## Daytona-to-controller handoff

The Codex worker's handoff responsibility ends with a verified outer ZIP in the Daytona
sandbox. Google Drive credentials and uploads are not part of this workflow.

1. The worker creates either the normal draft handoff or, only when normal submission cannot be
   produced, the recovery handoff described above.
2. Before exiting, it verifies that `/output` contains exactly that one outer ZIP. For a normal
   handoff, it verifies the required task ZIP, reasoning notes, draft proposal, optional validation
   summary, and nested `qc_artifacts/`. For a recovery handoff, it verifies the work-in-progress
   ZIP and failure summary.
3. The worker prints the absolute ZIP path, byte size, and SHA-256 digest in its final status.
4. After the worker exits, the local controller confirms that exactly one ZIP exists under
   `/output` and downloads it to a configured local output directory.
5. The controller verifies the downloaded file's size and SHA-256 digest against the remote
   file, then prints the final local path.
6. The controller deletes the Daytona sandbox only after the verified local download succeeds.
   On failure, it retains the sandbox and ZIP long enough to retry or recover them.

The ZIP must not contain credentials, unfiltered raw job directories, temporary files, or an
upload receipt. Curated check and probe evidence remains under `qc_artifacts/` in the nested
task ZIP. The full one-command factory run succeeds normally when the controller has a verified
local copy of the normal outer ZIP. A recovery handoff is a failed or incomplete run, but it must
still be downloaded and verified before cleanup so no completed work is lost. The Codex
construction phase must not exit until one of those verified ZIPs is present under `/output`.

## Completion standard

The job is complete only when:

- the real vulnerability is reproduced at the chosen base;
- the original relevant suite passes at base;
- every F2P fails at base for the intended reason and passes on gold;
- every P2P passes at base and on gold;
- the gold patch is minimal and closes the full approved security invariant;
- `instruction.md` is one short, natural, symptom-only user paragraph with no headings,
  ground rules, anti-cheat footer, or authoring/evaluation commentary;
- every current probe report corresponds to the final task state; any unresolved finding left
  solely because the bounded refinement budget was exhausted is accurately called out in the
  optional `validation-summary.md` for mandatory human review;
- all non-reasoning `rv check` findings are resolved or concretely justified;
- every probe category was run once with OpenRouter GLM 5.2, with at most one class-wide task
  correction and one targeted rerun of the affected category; if that rerun found another gap,
  no further probe loop was started and the remaining finding was documented;
- `rv oracle` scores 1.0;
- no secret, build residue, Python bytecode/cache residue, candidate diff, or superseded probe
  artifact is present; and
- the nested `rv submit` ZIP retains `qc_artifacts/` with the final probe reports;
- `/output` contains only the final outer handoff ZIP with its three required files and optional
  validation summary; and
- the controller downloads and verifies that exact ZIP locally before deleting the sandbox.

If these normal-completion conditions cannot be met, the job is incomplete rather than complete,
but the durability invariant still applies: create and return the verified recovery handoff before
exiting. There is no permitted path that returns neither a normal ZIP nor a recovery ZIP.

