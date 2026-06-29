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
    const opportunitiesCollection = database.collection("opportunities");
    const applicationsCollection = database.collection("applications");
    const paymentsCollection = database.collection("payments");

    // ── Users ──────────────────────────────────────────────────────────────

    app.get("/api/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.json(result);
    });

    app.patch("/api/users/:email", async (req, res) => {
      const result = await usersCollection.updateOne(
        { email: req.params.email }, // email is always reliable
        { $set: req.body },
      );
      console.log(result);
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });

    // ── Startups — specific routes BEFORE /:id ─────────────────────────────

    app.post("/api/startups", async (req, res) => {
      const result = await startupsCollection.insertOne(req.body);
      res.json({ success: true, insertedId: result.insertedId });
    });

    app.get("/api/startups/approved", async (req, res) => {
      const startups = await startupsCollection
        .find({ status: "approved" })
        .sort({ createdAt: -1 })
        .toArray();

      const withCounts = await Promise.all(
        startups.map(async (s) => {
          const count = await opportunitiesCollection.countDocuments({
            startup_id: s._id.toString(),
          });
          return { ...s, opportunityCount: count };
        }),
      );

      res.json(withCounts);
    });

    app.get("/api/startups/founder", async (req, res) => {
      const { email } = req.query;
      const startup = await startupsCollection.findOne({
        founder_email: email,
      });
      res.json(startup || null);
    });

    app.get("/api/startups", async (req, res) => {
      const result = await startupsCollection.find().toArray();
      res.json(result);
    });

    app.patch("/api/startups/:id", async (req, res) => {
      const result = await startupsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });

    app.delete("/api/startups/:id", async (req, res) => {
      const result = await startupsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json({ success: true, deletedCount: result.deletedCount });
    });

    //  dynamic /:id LAST
    app.get("/api/startups/:id", async (req, res) => {
      try {
        const startup = await startupsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!startup) return res.status(404).json({ error: "Not found" });
        res.json(startup);
      } catch {
        res.status(400).json({ error: "Invalid ID" });
      }
    });

    // ── Admin Startups ─────────────────────────────────────────────────────

    app.get("/api/admin/startups", async (req, res) => {
      const result = await startupsCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    });

    app.patch("/api/admin/startups/:id", async (req, res) => {
      const result = await startupsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });

    app.delete("/api/admin/startups/:id", async (req, res) => {
      const result = await startupsCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json({ success: true, deletedCount: result.deletedCount });
    });

    // ── Founder Stats ──────────────────────────────────────────────────────

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

      res.json({
        totalOpportunities: opportunities.length,
        totalApplications,
        acceptedMembers,
      });
    });

    // ── Opportunities — specific routes BEFORE /:id ────────────────────────

    app.post("/api/opportunities", async (req, res) => {
      const result = await opportunitiesCollection.insertOne(req.body);
      res.json({ success: true, insertedId: result.insertedId });
    });

    // all opportunities for admin — no filter
    app.get("/api/opportunities/all", async (req, res) => {
      const result = await opportunitiesCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    });

    // founder's own opportunities
    app.get("/api/opportunities/founder", async (req, res) => {
      const { email } = req.query;
      const result = await opportunitiesCollection
        .find({ founder_email: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    });

    // opportunities for a specific startup
    app.get("/api/opportunities/startup/:id", async (req, res) => {
      const result = await opportunitiesCollection
        .find({ startup_id: req.params.id, status: "open" })
        .sort({ createdAt: -1 })
        .toArray();
      res.json(result);
    });

    // public browse — search + filter + pagination
    app.get("/api/opportunities", async (req, res) => {
      const {
        search = "",
        workType = "",
        industry = "",
        page = "1",
        limit = "9",
      } = req.query;

      const filter = { status: "open" };

      if (search) {
        filter.$or = [
          { role_title: { $regex: search, $options: "i" } },
          { required_skills: { $regex: search, $options: "i" } },
        ];
      }
      if (workType) filter.work_type = { $in: [workType] };
      if (industry) filter.industry = { $in: [industry] };

      const skip = (Number(page) - 1) * Number(limit);
      const total = await opportunitiesCollection.countDocuments(filter);

      const opportunities = await opportunitiesCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .toArray();

      res.json({ opportunities, total });
    });

    app.patch("/api/opportunities/:id", async (req, res) => {
      const result = await opportunitiesCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });

    app.delete("/api/opportunities/:id", async (req, res) => {
      const result = await opportunitiesCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.json({ success: true, deletedCount: result.deletedCount });
    });

    //  dynamic /:id LAST
    app.get("/api/opportunities/:id", async (req, res) => {
      try {
        const opp = await opportunitiesCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!opp) return res.status(404).json({ error: "Not found" });
        res.json(opp);
      } catch {
        res.status(400).json({ error: "Invalid ID" });
      }
    });

    // ── Applications ───────────────────────────────────────────────────────

    app.post("/api/applications", async (req, res) => {
      const existing = await applicationsCollection.findOne({
        opportunity_id: req.body.opportunity_id,
        applicant_email: req.body.applicant_email,
      });

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

      res.json({ success: true, insertedId: result.insertedId });
    });

    app.patch("/api/applications/:id", async (req, res) => {
      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: req.body },
      );
      res.json({ success: true, modifiedCount: result.modifiedCount });
    });
    
    app.get("/api/applications/check", async (req, res) => {
      const { opportunity_id, applicant_email } = req.query;
      const existing = await applicationsCollection.findOne({
        opportunity_id,
        applicant_email,
      });
      res.json({ hasApplied: !!existing });
    });

    // founder — all applications for their opportunities
    app.get("/api/applications/founder", async (req, res) => {
      const { email } = req.query;

      const startup = await startupsCollection.findOne({
        founder_email: email,
      });
      if (!startup) return res.json([]);

      const opportunities = await opportunitiesCollection
        .find({ startup_id: startup._id.toString() })
        .toArray();

      if (opportunities.length === 0) return res.json([]);

      const oppIds = opportunities.map((o) => o._id.toString());

      const applications = await applicationsCollection
        .find({ opportunity_id: { $in: oppIds } })
        .sort({ applied_at: -1 })
        .toArray();

      const oppMap = Object.fromEntries(
        opportunities.map((o) => [o._id.toString(), o]),
      );

      const enriched = applications.map((app) => ({
        ...app,
        role_title: oppMap[app.opportunity_id]?.role_title ?? "—",
        startup_name: startup.startup_name,
        deadline: oppMap[app.opportunity_id]?.deadline ?? null,
      }));

      res.json(enriched);
    });

    // collaborator — all their own applications
    app.get("/api/applications/collaborator", async (req, res) => {
      const { email } = req.query;

      const applications = await applicationsCollection
        .find({ applicant_email: email })
        .sort({ applied_at: -1 })
        .toArray();

      if (applications.length === 0) return res.json([]);

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

      res.json(enriched);
    });

    // ── Payments ───────────────────────────────────────────────────────────

    app.post("/api/payments", async (req, res) => {
      const payload = req.body;

      // duplicate-safe — session_id is unique per Stripe checkout
      const existing = await paymentsCollection.findOne({
        transaction_id: payload.transaction_id,
      });

      if (existing) {
        return res.json({ success: true, duplicate: true });
      }

      await paymentsCollection.insertOne(payload);

      await usersCollection.updateOne(
        { email: payload.user_email },
        { $set: { plan: "premium" } },
      );

      res.json({ success: true });
    });

    app.get("/api/payments", async (req, res) => {
      const payments = await paymentsCollection
        .find({})
        .sort({ paid_at: -1 })
        .toArray();
      res.json(payments);
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
  console.log(`Server running on port ${PORT}`);
});
