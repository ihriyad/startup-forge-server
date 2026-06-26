const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const database = client.db("startup-forge");
    const usersCollection = database.collection("user");
    const startupsCollection = database.collection("startups");
    //user related api

    app.get("/api/users", async (req, res) => {
      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.patch("/api/users/:id", async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      // console.log(updateData);

      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: updateData };

      const result = await usersCollection.updateOne(filter, updateDoc);

      res.send(result);
    });

    // founder related api
    app.get("/api/startups", async (req, res) => {
      const cursor = startupsCollection.find();
      const startups = await cursor.toArray();
      for (const startup of startups) {
        const filter = {
          startupId: startup._id.toString(),
        };
        const opportunitiesCount =
          await startupsCollection.countDocuments(filter);
        startup.opportunitiesCount = opportunitiesCount;
      }
      res.send(startups || {});
    });

    app.get("/api/startups/founder", async (req, res) => {
      const { email } = req.query;
      const startup = await startupsCollection.findOne({
        founder_email: email,
      });
      res.send(startup || {});
    });


    app.post("/api/startups", async (req, res) => {
      const startup = req.body;
      const result = await startupsCollection.insertOne(startup);
      res.send(result);
    });

    app.delete("/api/startups/:id", async (req, res) => {
      const result = await startupsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });

      res.send(result);
    });

    app.patch("/api/startups/:id", async (req, res) => {
      const result = await startupsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.send(result);
    });

    // founder stats — opportunities + applications + accepted count
    app.get("/api/founder/stats", async (req, res) => {
      const { email } = req.query;
      const startup = await startupsCollection.findOne({
        founder_email: email,
      });

      if (!startup)
        return res.json({
          totalOpportunities: 0,
          totalApplications: 0,
          acceptedMembers: 0,
        });

      const opportunitiesCollection = database.collection("opportunities");
      const applicationsCollection = database.collection("applications");

      const opportunities = await opportunitiesCollection
        .find({ startup_id: startup._id.toString() })
        .toArray();

      const oppIds = opportunities.map((o) => o._id.toString());

      const totalApplications = await applicationsCollection.countDocuments({
        opportunity_id: { $in: oppIds },
      });

      const acceptedMembers = await applicationsCollection.countDocuments({
        opportunity_id: { $in: oppIds },
        status: "accepted",
      });

      res.send({
        totalOpportunities: opportunities.length,
        totalApplications,
        acceptedMembers,
      });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close();
  }
}
process.on("unhandledRejection", (err) => console.error(err));
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Startup Forge server is working fine");
});

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}`);
});
