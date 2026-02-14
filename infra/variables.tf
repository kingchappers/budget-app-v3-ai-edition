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
  description = "The name of the application."
  type        = string
  default     = "my-app"
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
}

variable "auth0_client_id" {
  type        = string
  description = "Auth0 client ID"
  sensitive   = true
}
variable "auth0_audience" {
  type        = string
  description = "Auth0 API audience identifier"
}