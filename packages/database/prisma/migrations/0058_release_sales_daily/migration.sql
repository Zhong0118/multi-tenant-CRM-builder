-- Existing plans retain their explicit grants. Platform administrators can now add these features.
UPDATE ai_feature_catalog
SET released = true
WHERE key IN ('daily_brief', 'writing', 'daily_report');
