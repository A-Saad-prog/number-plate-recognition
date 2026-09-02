@"
# STABLE VISION SAVEPOINT — 2026-09-02

Git commit:
2c8c0a234c2cdeebb9bee8e4f303541aaf7e67a6

Git tag:
stable-vision-2026-09-02

Status at physical test:
- Rectangular plate recognition working
- Square/two-line recognition restored to tested implementation
- KMJ-9427 entry recognized correctly
- KMJ-9427 exit recognized correctly
- KBX-4106 recognized correctly
- Typical YOLO latency: ~95-120 ms
- Typical warmed OCR latency: ~40-60 ms
- Typical successful total backend latency: ~140-180 ms
- Automatic entry/exit and newer billing/frontend features preserved

Important:
Do not modify plate recognition casually.
This checkpoint exists for rollback if OCR accuracy or latency regresses.

FULL ROLLBACK:
git reset --hard stable-vision-2026-09-02

SAFER ROLLBACK WITHOUT REWRITING HISTORY:
git checkout stable-vision-2026-09-02 -- backend/app/services/plate_recognition.py

Then:
git commit -m "restore stable vision checkpoint"
git push origin main
"@ | Set-Content SAVEPOINT_STABLE_VISION_2026-09-02.md