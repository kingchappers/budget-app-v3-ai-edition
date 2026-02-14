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