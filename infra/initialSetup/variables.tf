variable "aws_region" {
  description = "The AWS region to deploy resources in."
  type        = string
  default     = "eu-west-2"
}

variable "state_bucket" {
  description = "The name of the S3 bucket to store Terraform state."
  type        = string
}

variable "environment" {
  type    = string
  default = "production"
}

variable "app_name" {
  description = "The name of the application."
  type        = string
}

variable "github_repo" {
  description = "Name of the GitHub repository (under kingchappers) whose workflows may assume the CI role. It must match the repository's current name: the OIDC token's subject names it, so a repository rename stops CI authenticating until this is applied."
  type        = string
  default     = "hoardwise"
}

variable "custom_domain" {
  description = "The app's custom domain name in API Gateway. The deploy role may only manage this one (INFRA-01)."
  type        = string
  default     = "budget.scgrid.xyz"
}
