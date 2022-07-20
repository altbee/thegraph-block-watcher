require("dotenv").config();

const schedule = require("node-schedule");
const pgp = require("pg-promise")();
const { providers } = require("ethers");

const PSQL_URL = process.env.PSQL_URL;
const DEPLOYMENT = process.env.DEPLOYMENT;

const { JsonRpcProvider } = providers;
const provider = new JsonRpcProvider("https://evmexplorer.velas.com/rpc", 106);

// https://stackoverflow.com/questions/9205496/how-to-make-connection-to-postgres-via-node-js

let latestBlockNumber = 0;

const checkAndUpdate = async () => {
  const db = pgp(PSQL_URL);

  const result = await db.one(
    "SELECT latest_ethereum_block_number FROM subgraphs.subgraph_deployment WHERE deployment = $1",
    [DEPLOYMENT]
  );
  const curBlockNumber = Number(result.latest_ethereum_block_number);

  console.log("prevBlockNumber", latestBlockNumber);
  console.log("curBlockNumber", curBlockNumber);

  if (latestBlockNumber === 0) {
    latestBlockNumber = curBlockNumber;
  } else if (latestBlockNumber === curBlockNumber) {
    // need to get block info
    console.log("===should update===");

    const block = await provider.getBlock(curBlockNumber - 1);
    const blockHash = block.hash;

    console.log(
      `===previous number: ${curBlockNumber - 1}: hash ${blockHash}===`
    );

    try {
      const data = await db.tx((t) => {
        return t.none(
          `update subgraphs.subgraph_deployment sd
set latest_ethereum_block_hash = decode($1, 'hex'),
latest_ethereum_block_number = $2
where sd.deployment = $3`,
          [blockHash.substring(2), curBlockNumber - 1, DEPLOYMENT]
        );
      });
      console.log("success:", data);
    } catch (error) {
      console.error(error);
    }
  }
};

const main = async () => {
  schedule.scheduleJob("0 * * * *", function () {
    console.log(`======${new Date().toTimeString()}======`);
    // every hour
    checkAndUpdate()
      .then(() => {
        console.log("====Done====");
      })
      .catch((err) => {
        console.error("===", err);
      });
  });
};

main();
