# deploy.sh pushes readaloud-web:<commit> here; k3s pulls it with the instance role
# through the ECR credential provider (user-data.sh.tftpl).
resource "aws_ecr_repository" "web" {
  name                 = "readaloud-web"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images, enough to roll back"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
