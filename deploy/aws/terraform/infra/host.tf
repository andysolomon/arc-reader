# The k3s host. User data runs only on an instance's first boot, and later changes to
# it or to the AMI are ignored: replace the instance to apply them
# (deploy/aws/terraform.sh infra apply -replace=aws_instance.host). Everything that
# must survive a replacement lives on the data volume.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "host" {
  name               = "readaloud-host"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# Image pulls through the ECR credential provider.
resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# deploy.sh reads the kubeconfig through SSM Run Command; it is also a shell of last resort.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.host.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "host" {
  name = "readaloud-host"
  role = aws_iam_role.host.name
}

# The library, prepared audio, k3s state and Tailscale identity.
resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "readaloud-data", Backup = "readaloud" }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "host" {
  # Bootstrap downloads need a working route and the instance's IAM permissions.
  depends_on = [
    aws_route_table_association.public,
    aws_vpc_security_group_egress_rule.all,
    aws_iam_role_policy_attachment.ecr,
    aws_iam_role_policy_attachment.ssm,
  ]
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.host.id]
  iam_instance_profile   = aws_iam_instance_profile.host.name

  metadata_options {
    http_tokens = "required"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 30
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user-data.sh.tftpl", {
    data_volume_serial = replace(aws_ebs_volume.data.id, "-", "")
    hostname           = var.hostname
    tailnet            = var.tailnet
    tailscale_auth_key = base64encode(var.tailscale_auth_key)
    k3s_version        = var.k3s_version
    web_node_port      = 30179
  })

  tags = { Name = "readaloud" }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.host.id
  stop_instance_before_detaching = true
}
