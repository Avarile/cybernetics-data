# Run `make build.app` in root folder

# Run the following script to export the selected local image, scp to remote desired server, then install docker to that server:
docker save cybernetics:release.2026-05-14T14-54-58Z.1 | ssh Micro-server docker load

- After that, update the docker-compose.yaml to consume the new image

or run the deploy.sh:

IMAGE                                        ID             DISK USAGE   CONTENT SIZE   EXTRA
ai-agent-backend:latest                      7a2e117d8eec        740MB             0B    U   
ai-agent-mastra:latest                       2e3faa1f89b9        179MB             0B    U   
cybernetics:develop                          dd11291cab12        3.1GB             0B        
cybernetics:release.2026-06-10T04-05-13Z.1   dd11291cab12        3.1GB             0B        
getmeili/meilisearch:v1.22.1                 0555765269a7        151MB             0B    U   
pgvector/pgvector:pg17                       0a6f04bf3695        445MB             0B    U   
qdrant/qdrant:latest                         d2ea76deb232        189MB             0B    U   
rabbitmq:3.13.7-management-alpine            98c7053953cc        176MB             0B    U   
redis:6.2-alpine                             b7f611844a19       30.2MB             0B    U   
λ workstation data-centre → λ git dev → cd scripts/customized/start-server/docker-compose/                                   
λ workstation docker-compose → λ git dev → bash deploy.sh release.2026-06-10T04-05-13Z.