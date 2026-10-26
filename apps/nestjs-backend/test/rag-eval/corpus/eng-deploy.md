# Deployment runbook

## Cluster

Production runs on a three-node k3s cluster. Images are pushed to the private registry registry.internal:5000 by the CI pipeline after the tests pass. The app is deployed with a Helm chart named platform.

## Rolling out

Deploy a new version with `helm upgrade platform ./chart --set image.tag=<tag>`. To restart pods without a new image, run `kubectl rollout restart deployment/platform-backend`. Watch the rollout with `kubectl rollout status`.

## Rolling back

If error rates rise after a deploy, roll back immediately with `helm rollback platform` to the previous revision. Then open an incident in the on-call channel. Do not try to hotfix in production first.

## Known noise

When cleaning old images, `crictl rmi` can time out on large layers. The timeout is harmless; the image is removed in the background. Disk usage on the nodes should stay below 80 percent.
