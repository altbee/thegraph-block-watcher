require("dotenv").config();

const schedule = require("node-schedule");
const pgp = require("pg-promise")();
const { providers } = require("ethers");
const axios = require("axios");

const PSQL_URL = process.env.PSQL_URL;
const DEPLOYMENT = process.env.DEPLOYMENT;

const { JsonRpcProvider } = providers;
const provider = new JsonRpcProvider("https://evmexplorer.velas.com/rpc", 106);

// https://stackoverflow.com/questions/9205496/how-to-make-connection-to-postgres-via-node-js

let latestBlockNumber = 0;
let badCount = 0;
const BadLimit = 60;

const db = pgp(PSQL_URL);

const getBlockData = async (number) => {
  const data = await axios.post("https://evmexplorer.velas.com/rpc", {
    jsonrpc: "2.0",
    method: "eth_getBlockByNumber",
    params: [`0x${Number(number).toString(16)}`, true],
    id: 1,
  });
  return data.data.result;
};

const checkAndUpdate = async () => {
  const result = await db.one(
    "SELECT latest_ethereum_block_number FROM subgraphs.subgraph_deployment WHERE deployment = $1",
    [DEPLOYMENT]
  );
  const curBlockNumber = Number(result.latest_ethereum_block_number);

  console.log(
    `===== last Save Block Number: ${latestBlockNumber} === current syncing block number: ${curBlockNumber} =====`
  );

  if (latestBlockNumber === 0) {
    latestBlockNumber = curBlockNumber;
  } else if (latestBlockNumber === curBlockNumber) {
    // need to get block info
    badCount++;

    if (badCount === BadLimit) {
      let finalizedNumber = curBlockNumber - 1;
      let finalizedBlockHash;

      while (true) {
        const block = await getBlockData(finalizedNumber);

        if (block && block.isFinalized) {
          finalizedBlockHash = block.hash;
          break;
        }
      }

      console.log(
        `===should update to==previous number: ${finalizedNumber}: hash ${finalizedBlockHash}===`
      );

      try {
        const data = await db.tx((t) => {
          return t.none(
            `update subgraphs.subgraph_deployment sd
set latest_ethereum_block_hash = decode($1, 'hex'),
latest_ethereum_block_number = $2
where sd.deployment = $3`,
            [finalizedBlockHash.substring(2), finalizedNumber, DEPLOYMENT]
          );
        });
        console.log("success:", data);

        latestBlockNumber = finalizedNumber;
        badCount = 0;
      } catch (error) {
        console.error(error);
      }
    }
  } else {
    latestBlockNumber = curBlockNumber;
    badCount = 0;
  }
};

const main = async () => {
  schedule.scheduleJob("* * * * *", function () {
    console.log(`======${new Date().toTimeString()}======`);
    // every minute
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
