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
  description = "Name of the GitHub repository (under kingchappers) whose workflows may assume the CI role. It must match the repository's current name."
  type        = string
  default     = "hoardwise"
}

# GitHub gives a renamed repository an OIDC subject that embeds the owner and repository IDs, for example
# repo:kingchappers@10738951/hoardwise@1157808700:pull_request, so a new repository that later takes the old name cannot impersonate it.
# Both IDs are public: the owner's from https://api.github.com/users/kingchappers, the repository's from https://api.github.com/repos/kingchappers/hoardwise.
variable "github_owner_id" {
  description = "The numeric GitHub ID of the account that owns the repository."
  type        = string
  default     = "10738951"
}

variable "github_repo_id" {
  description = "The numeric GitHub ID of the repository."
  type        = string
  default     = "1157808700"
}

variable "custom_domain" {
  description = "The app's custom domain name in API Gateway. The deploy role may only manage this one (INFRA-01)."
  type        = string
  default     = "budget.scgrid.xyz"
}

variable "additional_custom_domains" {
  description = "Further custom domain names in API Gateway that the deploy role may manage (INFRA-01). Keep in step with app_domain in infra/."
  type        = list(string)
  default     = ["app.hoardwise.xyz"]
}
