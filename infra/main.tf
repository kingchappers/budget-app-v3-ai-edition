terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = var.state_bucket
    key          = "${var.app_name}/terraform.tfstate"
    region       = var.aws_region
    use_lockfile = true
  }
}

provider "aws" {
  region = var.aws_region
}
