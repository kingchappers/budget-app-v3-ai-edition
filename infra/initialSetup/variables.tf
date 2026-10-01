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

variable "custom_domain" {
  description = "The app's custom domain name in API Gateway. The deploy role may only manage this one (INFRA-01)."
  type        = string
  default     = "budget.scgrid.xyz"
}
