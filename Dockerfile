FROM node:22

RUN node --version && npm --version
RUN npm install pm2 -g

WORKDIR /vx_archive

COPY . .

WORKDIR /vx_archive
RUN npm install && npm run build

EXPOSE 4244

WORKDIR /vx_archive/

CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
