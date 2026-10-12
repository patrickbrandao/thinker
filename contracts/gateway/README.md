# Gateway contracts

These tests protect stable behavior exposed by the Thinker gateway. They run
against the built application over HTTP and must not import backend source code
or test helpers.

Run them against a local Thinker instance:

```sh
THINKER_BASE_URL=http://127.0.0.1:2099 \
  node --test contracts/gateway/tests/*.test.mjs
```

The routed-response contract in `identifiers.test.mjs` also needs the key of
an agent whose default route reaches a working provider, in
`THINKER_CONTRACT_AGENT_KEY`. Without it that one test is skipped. Docker
Smoke passes the throwaway agent it creates.

Pull request CI runs two copies of the suite against the candidate application:

1. The contracts from the pull request's base commit protect existing behavior.
2. The contracts from the pull request validate additions and contract changes.

Removing a contract and its implementation therefore requires two pull
requests. First remove the contract while the implementation still satisfies
the baseline suite. After that merges, remove the implementation.

An exception approved on the issue (as for the `thk_` and `x-thinker-*`
rename in #21, which had no consumers to protect) changes the contract and the
implementation in one pull request labelled `contract-break`. The baseline
suite still runs and reports what broke, but its failure no longer fails the
job.

Keep this suite small and limited to durable public behavior. Implementation
details and provider-specific edge cases belong in the backend test suite.
