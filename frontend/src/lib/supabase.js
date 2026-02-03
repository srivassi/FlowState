import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://bojfagmgvegpeouytqhw.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvamZhZ21ndmVncGVvdXl0cWh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMjkzODIsImV4cCI6MjA3ODcwNTM4Mn0._b-keGqTRh9wNie5svCVW-wuhgAeIvC-ZmOz-398Rzc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)