output "s3_bucket_arn" {
  value = aws_s3_bucket.s3_bucket.arn
}

output "s3_bucket_id" {
  value = aws_s3_bucket.s3_bucket.id
}

output "cloudfront_arn" {
  value = aws_cloudfront_distribution.cloudfront_distribution.arn
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.cloudfront_distribution.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.cloudfront_distribution.domain_name
}

output "public_route53_record" {
  value = var.create_public_dns_record ? aws_route53_record.public_route53_record[0].fqdn : null
}
