FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY index.js ./

ENV COLLAB_PORT=4000
EXPOSE 4000

CMD ["node", "index.js"]
