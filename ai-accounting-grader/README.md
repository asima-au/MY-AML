# Accounting Answer Grader

A grader for AI accounting answers, built around the "Accountant – AI training" reviewer role: write prompts that test bookkeeping, reporting standards and tax; review the model's output for misapplied standards, arithmetic slips and entries that don't balance; rate it; and give the correct answer with working.

Plain JavaScript, no dependencies.

```sh
node ai-accounting-grader/cli.mjs list                  # the 12 test prompts
node ai-accounting-grader/cli.mjs prompt R3             # prompt to give a model
node ai-accounting-grader/cli.mjs grade R3 answer.txt   # grade its answer (or pipe on stdin)
node ai-accounting-grader/cli.mjs answer R3             # correct answer with working
npm run build:grader-demo                               # one-file browser version
```

## What it checks

| Check | How |
|---|---|
| Doesn't balance | Debits must equal credits across the answer |
| Wrong amount / side / missing line | Each gold journal line is matched by account, side and amount; 40+ account names map to canonical accounts |
| Arithmetic slips | Every stated calculation (`12,000 × 3 ÷ 12 = 3,000`) is recomputed, with percentages and operator precedence |
| Misapplied standards | Each prompt lists known failure patterns (GST at 10% of an inclusive price, AASB 16 lease expensed as rent, residual value ignored...) with a specific diagnosis |
| Reasoning gaps | Required concepts (for example net realisable value) and whether any working is shown |

**Rating:** 5 correct; 4 correct with a reasoning or presentation gap; 3 partly correct; 2 materially wrong (misapplied standard, doesn't balance, or a slip carried through); 1 little of value.

## Item bank

12 prompts in `src/items.js`: 5 bookkeeping, 5 reporting standards (AASB 116, 16, 15, 102), 2 tax (GST/BAS, AASB 112). Each has the gold answer, working, failure patterns and a realistic flawed AI answer. The tests require every gold answer to grade 5/5 and every flawed answer to be caught.

To add an item, copy one in `src/items.js` and run `npm test`.

## Limits

- It only grades answers to its own prompts, and it checks figures and structure, not the quality of an explanation. Read the reasoning yourself before rating.
- Tax items use Australian GST and AASB standards. AASB standards mirror IFRS, so R1–R5 and T2 also hold under IFRS.
- If you work on an AI training platform, check its rules on tools before using this for paid tasks. Many require your own unaided judgement. It is well suited to practice, and to writing and checking your own items.
