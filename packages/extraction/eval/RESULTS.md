# Extraction model comparison

Run: 2026-11-26T08:28:18.292Z · prompt v1 · 4 fixtures × 2 repeats = 42 field extractions per model.
Scored after the real pipeline's evidence validation, so a value with a non-verbatim quote counts as a gap.

| Model | Accuracy | Wrong | Missed | Hallucinated | Evidence rejected | Errors | Consistency | p50 latency | $/doc |
|---|---|---|---|---|---|---|---|---|---|
| openai/gpt-6-luna | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 2.7s | $0.00019 |
| anthropic/claude-haiku-5.5 | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 2.9s | $0.00038 |
| qwen/qwen4-max | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 6.2s | $0.00259 |
| google/gemini-3.8-flash | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 6.2s | $0.00316 |
| openai/gpt-6.2-sol | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 5.2s | $0.00410 |
| anthropic/claude-sonnet-5.5 | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 2.4s | $0.00545 |
| mistralai/mistral-large-4-0 | 100% (42/42) | 0 | 0 | 0 | 0 | 0 | 100% | 28.9s | $0.00662 |
| deepseek/deepseek-v4.1-flash | 98% (41/42) | 0 | 1 | 0 | 1 | 0 | 95% | 7.0s | $0.00085 |

**Columns:** *Wrong* = a value that doesn't match the key. *Missed* = a gap where the key has a value (including values dropped by evidence validation). *Hallucinated* = a value for a field the document doesn't contain (median_household_income). *Evidence rejected* = the model's quote wasn't verbatim, so the value was discarded.

## Failures

### deepseek/deepseek-v4.1-flash
- `market-report-excerpt-001.pdf` · vacancy_rate (run 2): **missed**, got gap · rejected: value "evidence" is not a valid percent

