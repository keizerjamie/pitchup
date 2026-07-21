import { createClient } from '@supabase/supabase-js'

// Server-only admin client with the service-role key. NEVER import this in a
// client component and never expose the key to the browser. Returns null when
// the key is not configured, so callers can degrade gracefully.
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return null

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
