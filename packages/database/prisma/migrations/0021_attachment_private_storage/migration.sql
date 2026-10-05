ALTER TABLE record_attachments ADD COLUMN storage_key varchar(300);
ALTER TABLE record_attachments DROP CONSTRAINT record_attachments_check;
ALTER TABLE record_attachments ADD CONSTRAINT record_attachments_content_location_check CHECK (
  (deleted_at IS NULL AND ((content IS NOT NULL AND storage_key IS NULL) OR (content IS NULL AND storage_key IS NOT NULL)) AND octet_length(content) IS NOT DISTINCT FROM byte_size)
  OR (deleted_at IS NOT NULL AND content IS NULL AND storage_key IS NULL)
);
CREATE UNIQUE INDEX record_attachments_storage_key_idx ON record_attachments(storage_key) WHERE storage_key IS NOT NULL;
