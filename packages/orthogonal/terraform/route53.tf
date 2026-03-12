resource "aws_route53_record" "public_route53_record" {
  count   = var.create_public_dns_record ? 1 : 0
  zone_id = local.public_hosted_zone_id
  name    = var.service_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cloudfront_distribution.domain_name
    zone_id                = aws_cloudfront_distribution.cloudfront_distribution.hosted_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "private_route53_record" {
  zone_id = data.terraform_remote_state.account.outputs.private_hosted_zone_id
  name    = var.service_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.cloudfront_distribution.domain_name
    zone_id                = aws_cloudfront_distribution.cloudfront_distribution.hosted_zone_id
    evaluate_target_health = true
  }
}
