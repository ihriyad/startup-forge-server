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

    //collections

    const database = client.db("startup-forge");
    const usersCollection = database.collection("user");
    const startupsCollection = database.collection("startups");
    const opportunitiesCollection = database.collection("opportunities");
    const applicationsCollection = database.collection("applications");

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

    // startup related
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

    //opportunities related

    app.post("/api/opportunities", async (req, res) => {
      const result = await opportunitiesCollection.insertOne(req.body);
      res.send(result);
    });

    app.get("/api/opportunities/founder", async (req, res) => {
      const { email } = req.query;
      const result = await opportunitiesCollection
        .find({ founder_email: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/api/opportunities/:id", async (req, res) => {
      const result = await opportunitiesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.send(result);
    });

    app.delete("/api/opportunities/:id", async (req, res) => {
      const result = await opportunitiesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });

    //application

    // get all applications for a founder's opportunities
    app.get("/api/applications/founder", async (req, res) => {
      const { email } = req.query;

      // find founder's startup first
      const startup = await startupsCollection.findOne({
        founder_email: email,
      });
      if (!startup) return res.send([]);

      // get all their opportunities
      const opportunities = await opportunitiesCollection
        .find({ startup_id: startup._id.toString() })
        .toArray();

      if (opportunities.length === 0) return res.send([]);

      const oppIds = opportunities.map((o) => o._id.toString());

      // get all applications for those opportunities
      // join role_title and startup_name for display
      const applications = await applicationsCollection
        .find({ opportunity_id: { $in: oppIds } })
        .sort({ applied_at: -1 })
        .toArray();

      // attach role_title + startup_name + deadline to each application
      const oppMap = Object.fromEntries(
        opportunities.map((o) => [o._id.toString(), o]),
      );

      const enriched = applications.map((app) => ({
        ...app,
        role_title: oppMap[app.opportunity_id]?.role_title ?? "—",
        startup_name: startup.startup_name,
        deadline: oppMap[app.opportunity_id]?.deadline ?? null,
      }));

      res.send(enriched);
    });

    app.post("/api/applications", async (req, res) => {
      const existing = await applicationsCollection.findOne({
        opportunity_id: req.body.opportunity_id,
        applicant_email: req.body.applicant_email,
      });

      // prevent duplicate applications
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "You have already applied to this opportunity.",
        });
      }

      const result = await applicationsCollection.insertOne({
        ...req.body,
        status: "pending",
        applied_at: new Date(),
      });

      res.send(result);
    });

    app.patch("/api/applications/:id", async (req, res) => {
      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.send(result);
    });

    // get all applications for a collaborator
    app.get("/api/applications/collaborator", async (req, res) => {
      const { email } = req.query;

      const applications = await applicationsCollection
        .find({ applicant_email: email })
        .sort({ applied_at: -1 })
        .toArray();

      if (applications.length === 0) return res.send([]);

      // enrich each application with role_title, startup_name, deadline
      const oppIds = applications
        .map((a) => {
          try {
            return new ObjectId(a.opportunity_id);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const opportunities = await opportunitiesCollection
        .find({ _id: { $in: oppIds } })
        .toArray();

      const oppMap = Object.fromEntries(
        opportunities.map((o) => [o._id.toString(), o]),
      );

      // get startup names
      const startupIds = [
        ...new Set(opportunities.map((o) => o.startup_id).filter(Boolean)),
      ];

      const startups = await startupsCollection
        .find({
          _id: {
            $in: startupIds
              .map((id) => {
                try {
                  return new ObjectId(id);
                } catch {
                  return null;
                }
              })
              .filter(Boolean),
          },
        })
        .toArray();

      const startupMap = Object.fromEntries(
        startups.map((s) => [s._id.toString(), s]),
      );

      const enriched = applications.map((app) => {
        const opp = oppMap[app.opportunity_id] ?? {};
        const startup = startupMap[opp.startup_id] ?? {};
        return {
          ...app,
          role_title: opp.role_title ?? "—",
          startup_name: startup.startup_name ?? "—",
          deadline: opp.deadline ?? null,
        };
      });

      res.send(enriched);
    });

    // GET all startups for admin
    app.get("/api/admin/startups", async (req, res) => {
      const result = await startupsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    });

    // PATCH — approve or any status update
    app.patch("/api/admin/startups/:id", async (req, res) => {
      const result = await startupsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });

    // DELETE — remove startup
    app.delete("/api/admin/startups/:id", async (req, res) => {
      const result = await startupsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json({ success: true, deletedCount: result.deletedCount });
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
