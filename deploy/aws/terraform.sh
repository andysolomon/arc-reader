#!/usr/bin/env bash
# Run Terraform for one stage of the AWS deployment, with its state and the root .env.
#   deploy/aws/terraform.sh infra apply  # set TF_VAR_tailscale_auth_key on first boot
#   deploy/aws/terraform.sh infra plan
#   deploy/aws/terraform.sh app plan     # web_image defaults to the image running now
# Uses the AWS CLI's credentials (aws configure, aws sso login or AWS_PROFILE).
# deploy.sh uses it too. State lives outside the repository.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

stage=${1:-}
case $stage in
  infra | app) shift ;;
  *) echo "usage: $0 infra|app <terraform arguments>" >&2; exit 2 ;;
esac
command -v terraform >/dev/null || { echo "terraform is not on the PATH (mise use -g terraform)" >&2; exit 1; }
command -v aws >/dev/null || { echo "aws is not on the PATH (mise use -g aws-cli)" >&2; exit 1; }

state=${XDG_STATE_HOME:-$HOME/.local/state}/readaloud/aws
cache=${XDG_CACHE_HOME:-$HOME/.cache}/readaloud-aws/terraform
mkdir -p "$state" "$cache"
chmod 700 "$state" # the app state holds the .env secrets
tf() {
  local stage=$1; shift
  TF_DATA_DIR="$cache/$stage" terraform -chdir="deploy/aws/terraform/$stage" "$@"
}
tf "$stage" init -input=false -backend-config="path=$state/$stage.tfstate" >/dev/null

if [ "$stage" = app ]; then
  kubeconfig=$HOME/.kube/readaloud-aws.yaml
  if [ ! -s "$kubeconfig" ]; then
    # k3s writes the admin kubeconfig on the host; read it through SSM and point it at
    # the API's tailnet name instead of 127.0.0.1.
    tf infra init -input=false -backend-config="path=$state/infra.tfstate" >/dev/null
    region=$(tf infra output -raw region)
    instance=$(tf infra output -raw instance_id)
    server=$(tf infra output -raw kube_server)
    echo "Waiting for SSM and first-boot setup on $instance" >&2
    for attempt in {1..120}; do
      online=$(aws ssm describe-instance-information --region "$region" \
        --filters "Key=InstanceIds,Values=$instance" \
        --query 'InstanceInformationList[0].PingStatus' --output text)
      [ "$online" != Online ] || break
      [ "$attempt" -lt 120 ] || { echo "SSM did not come online for $instance" >&2; exit 1; }
      sleep 5
    done
    command=$(aws ssm send-command --region "$region" --instance-ids "$instance" \
      --document-name AWS-RunShellScript \
      --parameters 'commands=["cloud-init status --wait >/dev/null || exit 1", "test -s /etc/rancher/k3s/k3s.yaml || exit 1", "cat /etc/rancher/k3s/k3s.yaml"],executionTimeout=["900"]' \
      --query Command.CommandId --output text)
    for attempt in {1..180}; do
      status=$(aws ssm get-command-invocation --region "$region" --command-id "$command" \
        --instance-id "$instance" --query Status --output text 2>/dev/null || true)
      case $status in
        Success) break ;;
        Failed|Cancelled|TimedOut)
          echo "Host setup failed ($status). Inspect /var/log/readaloud-setup.log through SSM." >&2
          exit 1 ;;
      esac
      [ "$attempt" -lt 180 ] || { echo "Timed out waiting for host setup; command $command" >&2; exit 1; }
      sleep 5
    done
    mkdir -p "$(dirname "$kubeconfig")"
    temporary=$(mktemp "$kubeconfig.XXXXXX")
    trap 'rm -f "$temporary"' EXIT
    aws ssm get-command-invocation --region "$region" --command-id "$command" --instance-id "$instance" \
      --query StandardOutputContent --output text | sed "s|https://127.0.0.1:6443|$server|" >"$temporary"
    kubectl --kubeconfig "$temporary" config view -o jsonpath='{.clusters[0].cluster.server}' | grep -Fxq "$server"
    mv "$temporary" "$kubeconfig"
    trap - EXIT
  fi

  . deploy/terraform/shared/env.sh
  if [ -z "${TF_VAR_web_image:-}" ]; then
    running=$(kubectl --kubeconfig "$kubeconfig" -n readaloud get deployment web \
      -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    [ -z "$running" ] || export TF_VAR_web_image=$running
  fi
fi

tf "$stage" "$@"
