aws_region     = "eu-west-2"
state_bucket   = "kingchappers-terraform-state-bucket"
app_name       = "budget-app-v3-ai-edition"
environment    = "production"
# Must match the Auth0 API Identifier the SPA requests (VITE_AUTH0_AUDIENCE).
# This file outranks TF_VAR_* env vars, so a wrong value here silently
# overrides the AUTH0_AUDIENCE secret in CI.
auth0_audience = "https://budget-api"
