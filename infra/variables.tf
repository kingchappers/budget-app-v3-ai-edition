variable "aws_region" {
  description = "The AWS region to deploy resources in."
  type        = string
  default     = "eu-west-2"
}

variable "state_bucket" {
  description = "The name of the S3 bucket to store Terraform state."
  type        = string
}

variable "app_name" {
  # No default (matches state_bucket): this names/tags every resource in the
  # stack. A generic placeholder default here previously let a local
  # `tofu plan`/`apply` run without TF_VAR_app_name silently target "my-app"
  # instead of the real app, producing a plan that renamed and replaced the
  # entire production stack (Lambda functions, DynamoDB table, IAM roles).
  # CI always sets TF_VAR_app_name explicitly and was never at risk; this
  # only protected against that path, not local runs.
  description = "The name of the application."
  type        = string
}

variable "environment" {
  type    = string
  default = "production"
}

####################################################################
############## Variables from Claude Agent, reviewing ##############
####################################################################

variable "auth0_domain" {
  type        = string
  description = "Auth0 domain"
  sensitive   = true
}

variable "auth0_client_id" {
  type        = string
  description = "Auth0 client ID"
  sensitive   = true
}

variable "auth0_audience" {
  type        = string
  description = "Auth0 API audience identifier"
  sensitive   = true
}

variable "app_base_url" {
  type        = string
  description = "Public base URL of the app (e.g. https://budget.example.com). Empty uses the API Gateway invoke URL. Used for the bank redirect URL."
  default     = ""
}