-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create discord schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS discord;

-- Create messages table with vector embeddings
CREATE TABLE IF NOT EXISTS discord.messages (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(255) NOT NULL,
    message_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    embedding vector(768),  -- 768 dimensions for embeddinggemma:300m
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster channel queries
CREATE INDEX IF NOT EXISTS idx_channel_id ON discord.messages (channel_id);

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_embedding ON discord.messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Create function to search for similar messages
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

-- Create function to get recent messages from a channel
CREATE OR REPLACE FUNCTION discord.get_recent_messages(
    query_channel_id VARCHAR(255),
    message_limit INT DEFAULT 10
)
RETURNS TABLE (
    id INTEGER,
    username VARCHAR(255),
    role VARCHAR(50),
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.username,
        m.role,
        m.content,
        m.created_at
    FROM discord.messages m
    WHERE m.channel_id = query_channel_id
    ORDER BY m.created_at DESC
    LIMIT message_limit;
END;
$$;
