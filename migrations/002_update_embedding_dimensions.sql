-- Update embedding column to 768 dimensions for embeddinggemma:300m
-- Drop existing indexes and column, then recreate with correct dimensions

-- Drop the vector similarity index
DROP INDEX IF EXISTS discord.idx_embedding;

-- Drop and recreate the embedding column with 768 dimensions
ALTER TABLE discord.messages DROP COLUMN IF EXISTS embedding;
ALTER TABLE discord.messages ADD COLUMN embedding vector(768);

-- Recreate index for vector similarity search
CREATE INDEX idx_embedding ON discord.messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Update function signatures to use 768 dimensions
DROP FUNCTION IF EXISTS discord.search_similar_messages;
CREATE OR REPLACE FUNCTION discord.search_similar_messages(
    query_embedding vector(768),
    query_channel_id VARCHAR(255),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id INTEGER,
    channel_id VARCHAR(255),
    username VARCHAR(255),
    role VARCHAR(50),
    content TEXT,
    similarity FLOAT,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.channel_id,
        m.username,
        m.role,
        m.content,
        1 - (m.embedding <=> query_embedding) AS similarity,
        m.created_at
    FROM discord.messages m
    WHERE m.channel_id = query_channel_id
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> query_embedding) > match_threshold
    ORDER BY m.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
