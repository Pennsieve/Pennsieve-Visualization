resource "aws_cloudfront_origin_access_identity" "cloudfront_origin_access_identity" {
  comment = "${var.environment_name}-${var.service_name}-${data.terraform_remote_state.region.outputs.aws_region_shortname}"
}

resource "aws_cloudfront_response_headers_policy" "embed_headers" {
  name = "${var.environment_name}-${var.service_name}-response-headers"

  cors_config {
    access_control_allow_origins {
      items = var.allowed_origins
    }

    access_control_allow_methods {
      items = ["GET", "HEAD"]
    }

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_credentials = false
    origin_override                  = true
  }

  security_headers_config {
    content_security_policy {
      content_security_policy = "frame-ancestors ${join(" ", var.allowed_origins)}"
      override                = true
    }
  }
}

resource "aws_cloudfront_distribution" "cloudfront_distribution" {
  aliases = ["${var.service_name}.${local.domain_name}"]

  comment             = aws_s3_bucket.s3_bucket.id
  default_root_object = "embed.html"
  enabled             = true
  is_ipv6_enabled     = var.is_ipv6_enabled
  price_class         = "PriceClass_All"

  # Assets: aggressive caching (filenames are content-hashed)
  ordered_cache_behavior {
    path_pattern           = "assets/*"
    allowed_methods = ["GET", "HEAD"]
    cached_methods = ["GET", "HEAD"]
    target_origin_id       = "${aws_s3_bucket.s3_bucket.id}S3Origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    default_ttl = 31536000 # 1 year
    max_ttl = 31536000
    min_ttl = 31536000

    response_headers_policy_id = aws_cloudfront_response_headers_policy.embed_headers.id

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  # Default: minimal caching for embed.html (deploys take effect immediately)
  default_cache_behavior {
    allowed_methods = ["GET", "HEAD"]
    cached_methods = ["GET", "HEAD"]
    target_origin_id       = "${aws_s3_bucket.s3_bucket.id}S3Origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    default_ttl = 0
    max_ttl     = 60
    min_ttl     = 0

    response_headers_policy_id = aws_cloudfront_response_headers_policy.embed_headers.id

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  logging_config {
    include_cookies = false
    bucket          = data.terraform_remote_state.region.outputs.logs_s3_bucket_domain_name
    prefix          = "${var.environment_name}/${var.service_name}/cloudfront/"
  }

  origin {
    domain_name = aws_s3_bucket.s3_bucket.bucket_domain_name
    origin_id   = "${aws_s3_bucket.s3_bucket.id}S3Origin"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.cloudfront_origin_access_identity.cloudfront_access_identity_path
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = merge(
    local.common_tags,
    {
      "Name" = "${var.environment_name}-${var.service_name}-cloudfront-distribution-${data.terraform_remote_state.region.outputs.aws_region_shortname}"
      "name" = "${var.environment_name}-${var.service_name}-cloudfront-distribution-${data.terraform_remote_state.region.outputs.aws_region_shortname}"
      "tier" = "cloudfront-distribution"
    },
  )

  viewer_certificate {
    acm_certificate_arn      = local.acm_certificate_arn
    minimum_protocol_version = var.minimum_protocol_version
    ssl_support_method       = "sni-only"
  }
}
