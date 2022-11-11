import StrapiService, { StrapiMedusaPluginOptions } from "../update-strapi";
import { jest, describe, expect, beforeEach, it } from "@jest/globals";
import { regionService, productService, redisClient,
  productVariantService, eventBusService,
  logger,
  enableMocks,
  disableMocks } from "../__mocks__/service-mocks";
import { randomInt } from "crypto";


// This sets the mock adapter on the default instance


let service:StrapiService;

describe("StrapiService", () => {
  const strapiConfigParameters: StrapiMedusaPluginOptions = {
    encryption_algorithm: "aes-256-cbc",
    strapi_protocol: "http",
    strapi_default_user_username: "testuser",
    strapi_host: "172.31.34.235",
    strapi_default_user_password: "testuser",
    strapi_default_user_email_address: "test1@test.com",
    strapi_default_user_firstname: "test1user",
    strapi_default_user_lastname: "test1user",
    strapi_admin_username: "SuperUser",
    strapi_admin_secret: "MedusaStrapi1",
    strapi_admin_email: "support@medusa-commerce.com",
    strapi_port: "1337",
    strapi_secret: "test",
    strapi_public_key: undefined,
    strapi_ignore_threshold: 0,
  };

  service = new StrapiService(
      {
        regionService,
        productService,
        redisClient,
        productVariantService,
        eventBusService,
        logger,
      },
      strapiConfigParameters,
  );

  const entry = {
    unpublish: jest.fn(async () => {
      return {
        id: "id",
      };
    }),
    archive: jest.fn(async () => {
      return {
        id: "id",
      };
    }),
  };


  beforeEach(() => {
    enableMocks();
    jest.clearAllMocks();
    service.strapiDefaultUserAuthToken="";
  });

  describe("health check", ()=>{
    it("check health", async ()=>{
      expect(service).toBeDefined();
      expect(service.checkStrapiHealth()).toBeTruthy();
    });
  });

  describe("create or register admin", ()=>{
    it("register or login addmin", async ()=>{
      await service.registerOrLoginAdmin();
      expect(service.strapiAdminAuthToken).toBeDefined();
      expect(service.strapiAdminAuthToken.length).toBeGreaterThan(0);
    });

    it("register or login default user", async () => {
      await service.registerOrLoginDefaultUser();
      expect(service.strapiDefaultUserAuthToken).toBeDefined();
      expect(service.strapiDefaultUserAuthToken.length).toBeGreaterThan(0);
    });
  });
});

describe("create product in strapi", () => {
  const spy = jest.spyOn(service, "getType");
  it("Calls entry.unpublish and entry.archive", async () => {
    const result = await service.createProductInStrapi( "exists" );
    expect(result).toBeDefined();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  /* it("Doesn't call entry.unpublish and entry.archive
    if the product still exists in medusa", async () => {
        await service.createProductInStrapi("exists")

        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })

      it("Doesn't call productService if
      request should be ignored", async () => {
        await service.({ id: "ignored" })

        expect(productService.retrieve).toHaveBeenCalledTimes(0)
        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })*/

/*
    describe("archiveProductVariantInStrapi", () => {
      it("Calls entry.unpublish and entry.archive", async () => {
        await service.archiveProductVariantInStrapi({ id: "test" })

        expect(entry.unpublish).toHaveBeenCalledTimes(1)
        expect(entry.archive).toHaveBeenCalledTimes(1)
      })

      it("Doesn't call entry.unpublish and entry.
      archive if the variant still exists in medusa", async () => {
        await service.archiveProductVariantInStrapi({ id: "exists" })

        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })

      it("Doesn't call productVariantService
       if request should be ignored", async () => {
        await service.archiveProductVariantInStrapi({ id: "ignored" })

        expect(productVariantService.retrieve).toHaveBeenCalledTimes(0)
        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })
    })

    /*describe("archiveRegionInStrapi", () => {
      it("Calls entry.unpublish and entry.archive", async () => {
        await service.archiveRegionInStrapi({ id: "test" })

        expect(entry.unpublish).toHaveBeenCalledTimes(1)
        expect(entry.archive).toHaveBeenCalledTimes(1)
      })

      it("Doesn't call entry.unpublish and entry.
      archive if the region still exists in medusa", async () => {
        await service.archiveRegionInStrapi({ id: "exists" })

        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })

      it("Doesn't call RegionService
      if request should be ignored", async () => {
        await service.archiveRegionInStrapi({ id: "ignored" })

        expect(regionService.retrieve).toHaveBeenCalledTimes(0)
        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })
    })

    describe("archiveEntryWidthId", () => {
      it("Calls archive if entry exists", async () => {
        await service.archiveEntryWidthId("exists")

        expect(entry.unpublish).toHaveBeenCalledTimes(1)
        expect(entry.archive).toHaveBeenCalledTimes(1)
      })
      it("Doesnt call archive if entry doesn't exists", async () => {
        await service.archiveEntryWidthId("onlyMedusa")

        expect(entry.unpublish).toHaveBeenCalledTimes(0)
        expect(entry.archive).toHaveBeenCalledTimes(0)
      })
    })
  })*/
});
