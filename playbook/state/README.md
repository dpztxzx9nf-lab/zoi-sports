# State

`last-snapshot.json` is the baseline every future snapshot is compared against. It's the reason a
diff can say "sensitivity moved" instead of just showing today's numbers with nothing to compare
to.

Replace it whenever a new snapshot has been reviewed and logged. Until it's replaced, every run
reports the same changes — which is a useful reminder that the log hasn't caught up, and a noisy
one if left too long.

No secrets in here. Just Fortnite's own settings.
