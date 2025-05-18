// Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://xxwqvakpzijmwrmicbgs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4d3F2YWtwemlqbXdybWljYmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDUzNDAxMTksImV4cCI6MjA2MDkxNjExOX0.InPR-ZWlP4tP48Da7VBBSLTTr6uTvuZdjzlMETBrAQA';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
