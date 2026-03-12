variable "aws_account" {}

variable "environment_name" {}

variable "service_name" {}

variable "vpc_name" {}

variable "allowed_origins" {
  type = list(string)
  description = "Origins allowed to iframe this site and make CORS requests"
}

variable "is_ipv6_enabled" {
  default = false
}

variable "create_public_dns_record" {
  default = true
}

variable "minimum_protocol_version" {
  default = "TLSv1.2_2018"
}

locals {
  domain_name           = data.terraform_remote_state.account.outputs.domain_name
  public_hosted_zone_id = data.terraform_remote_state.account.outputs.public_hosted_zone_id
  acm_certificate_arn   = data.terraform_remote_state.region.outputs.wildcard_cert_arn

  common_tags = {
    aws_account      = var.aws_account
    aws_region       = data.aws_region.current_region.name
    environment_name = var.environment_name
    service_name     = var.service_name
  }
}
