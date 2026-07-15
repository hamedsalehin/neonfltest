-- ============================================================================
-- NANO SIGN DATABASE SCHEMA SETUP
-- Run this in your Supabase Dashboard -> SQL Editor -> click "Run"
-- ============================================================================

-- Helper functions for security and verification

-- 1. Email Normalization Function (prevents gmail alias subaddressing abuse)
CREATE OR REPLACE FUNCTION public.normalize_email(email TEXT)
RETURNS TEXT AS $$
DECLARE
    parts TEXT[];
    local_part TEXT;
    domain_part TEXT;
BEGIN
    parts := string_to_array(lower(trim(email)), '@');
    IF array_length(parts, 1) != 2 THEN
        RETURN lower(trim(email));
    END IF;
    
    local_part := parts[1];
    domain_part := parts[2];
    
    -- Gmail/Google Suite normalization: remove dots and subaddress '+' suffix
    IF domain_part = 'gmail.com' OR domain_part = 'googlemail.com' THEN
        local_part := split_part(local_part, '+', 1);
        local_part := replace(local_part, '.', '');
    END IF;
    
    RETURN local_part || '@' || domain_part;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2. Email Verification Check Function (ensures email is authenticated)
CREATE OR REPLACE FUNCTION public.is_email_verified(email_to_check TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    is_verified BOOLEAN;
BEGIN
    SELECT (email_confirmed_at IS NOT NULL) INTO is_verified
    FROM auth.users
    WHERE email = email_to_check;
    
    RETURN COALESCE(is_verified, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Create Tables

-- 3. Create Profiles Table (to track 15% discount usage)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    normalized_email TEXT,
    full_name TEXT,
    has_discount_used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Users can view own profile" ON public.profiles 
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles 
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role has full access" ON public.profiles
    USING (true) WITH CHECK (true);

-- 4. Create Saved Designs Table (for customizer sign settings)
CREATE TABLE IF NOT EXISTS public.saved_designs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT DEFAULT 'Untitled Design',
    design_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) for saved_designs
ALTER TABLE public.saved_designs ENABLE ROW LEVEL SECURITY;

-- Saved Designs Policies
CREATE POLICY "Users can insert own designs" ON public.saved_designs 
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own designs" ON public.saved_designs 
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own designs" ON public.saved_designs 
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own designs" ON public.saved_designs 
    FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role has full access on designs" ON public.saved_designs
    USING (true) WITH CHECK (true);

-- 5. Automatic Profile Creation Trigger
-- Ensures a public profile is created instantly when a user registers on auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, normalized_email, full_name, has_discount_used)
    VALUES (
        new.id, 
        new.email,
        public.normalize_email(new.email),
        COALESCE(new.raw_user_meta_data->>'full_name', 'Member'),
        FALSE
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
