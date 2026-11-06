# One public subnet: the instance needs outbound internet (ECR, Tailscale, k3s, the
# LLM and speech APIs) and nothing inbound. The CIDR stays clear of k3s's pod and
# service ranges (10.42.0.0/16, 10.43.0.0/16).
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "readaloud" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "readaloud" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.20.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "readaloud-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "readaloud-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "host" {
  name        = "readaloud-host"
  description = "ReadAloud host: Tailscale only"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "readaloud-host" }
}

# Tailscale works without it (through relays), but direct connections are faster.
# WireGuard drops anything not from a tailnet peer.
resource "aws_vpc_security_group_ingress_rule" "tailscale" {
  security_group_id = aws_security_group.host.id
  description       = "Tailscale direct connections"
  ip_protocol       = "udp"
  from_port         = 41641
  to_port           = 41641
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
