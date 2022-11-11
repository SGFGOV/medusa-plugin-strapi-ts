import { BaseService } from "medusa-interfaces";
import axios, { AxiosResponse, Method } from "axios";
import crypto = require("crypto");
import { timeStamp } from "console";
import { Logger } from "@medusajs/medusa/dist/types/global";
import { EventBusService, ProductService,
  ProductVariantService, RegionService } from "@medusajs/medusa";
import { report } from "process";

const IGNORE_THRESHOLD = 3; // seconds

export interface StrapiMedusaPluginOptions
{
  encryption_algorithm:string
  strapi_protocol:string;
  strapi_default_user_email_address: string;
  strapi_default_user_username:string;
  strapi_host:string;
  strapi_default_user_firstname:string;
  strapi_default_user_lastname:string;
  strapi_default_user_password:string;
  strapi_admin_username:string;
  strapi_admin_email:string;
  strapi_admin_firstname?:string;
  strapi_admin_lastname?:string;
  strapi_admin_secret:string;
  strapi_port:string
  strapi_secret?:string;
  strapi_public_key?:string;
  strapi_ignore_threshold:number;
}

export interface MedusaUserId{
  username: string;
  password: string,
  email: string,
  confirmed: boolean,
  blocked: boolean,
  provider: string,
}

export type UserType = {
  email:string;
  username: string;
  password: string;
  firstname?:string;
  name?:string;
  lastname?:string;
};

class UpdateStrapiService extends BaseService {
  productService_: ProductService;
  productVariantService_: ProductVariantService;
  regionService_: RegionService;
  eventBus_: EventBusService;
  algorithm: string;
  options_: StrapiMedusaPluginOptions;
  protocol: string;
  strapi_url: string;
  encryption_key: any;
  strapiDefaultUserAuthToken: string;
  redis_: any;
  strapiDefaultUserProfile: any;
  key: WithImplicitCoercion<ArrayBuffer | SharedArrayBuffer>;
  iv: any;
  strapiAdminAuthToken: string;

  userAdminProfile: any;
  logger: Logger;
  isHealthy: boolean;
  strapiDefaultUserId: any;
  constructor(
      {
        regionService,
        productService,
        redisClient,
        productVariantService,
        eventBusService,
        logger,
      },
      options:StrapiMedusaPluginOptions,
  ) {
    super();

    this.logger = logger;
    this.productService_ = productService;
    this.productVariantService_ = productVariantService;
    this.regionService_ = regionService;
    this.eventBus_ = eventBusService;
    this.options_ = options;
    this.algorithm = this.options_.
        encryption_algorithm||"aes-256-cbc"; // Using AES encryption
    this.iv = crypto.randomBytes(16);
    this.protocol = this.options_.strapi_protocol;

    this.strapi_url=`${this.protocol??"https"}://${this.options_.strapi_host??"localhost"}:${this.options_.strapi_port??1337}`;

    this.encryption_key = this.options_.strapi_secret||
    this.options_.strapi_public_key;
    this.strapiDefaultUserAuthToken = "";
    this.isHealthy = false;
    this.checkStrapiHealth().then((res) => {
      if (res) {
        logger.info("Strapi Health Check Ok");
        this.isHealthy = res;
      }
    });

    // attaching the default user
    this.redis_ = redisClient;
  }

  async startInterface():Promise<void|Error> {
    try {
      await this.intializeServer();
      this.logger.info("Successfully Bootstrapped the strapi server");
    } catch (e) {
      this.logger.error(`Unable to  bootstrap the strapi server, 
        please check configuration , ${e}`);
      return e;
    }
  }


  async addIgnore_(id, side):Promise<any> {
    const key = `${id}_ignore_${side}`;
    return await this.redis_.set(
        key,
        1,
        "EX",
        this.options_.strapi_ignore_threshold || IGNORE_THRESHOLD,
    );
  }

  async shouldIgnore_(id, side):Promise<any> {
    const key = `${id}_ignore_${side}`;
    return await this.redis_.get(key);
  }

  async getVariantEntries_(variants):Promise<any> {
    // eslint-disable-next-line no-useless-catch
    try {
      const allVariants = variants.map(async (variant) => {
        // update product variant in strapi
        const result = await this.updateProductVariantInStrapi(variant);
        return result.productVariant;
      });
      return Promise.all(allVariants);
    } catch (error) {
      throw error;
    }
  }

  async createImageAssets(product):Promise<any> {
    const assets = await Promise.all(
        product.images
            ?.filter((image) => image.url !== product.thumbnail)
            .map(async (image, i) => {
              const result = await this.
                  createEntryInStrapi("images", product.id, {
                    image_id: image.id,
                    url: image.url,
                    metadata: image.metadata || {},
                  });
              return result?.data?.image??undefined;
            }),
    );
    return assets || [];
  }

  getCustomField(field, type):string {
    const customOptions = this.options_[`custom_${type}_fields`];

    if (customOptions) {
      return customOptions[field] || field;
    } else {
      return field;
    }
  }

  async createProductInStrapi(productId):Promise<any> {
    const hasType = await this.getType("products")?true:false;
    if (!hasType) {
      return Promise.resolve();
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const product = await this.productService_.retrieve(productId, {
        relations: [
          "options",
          "variants",
          "variants.prices",
          "variants.options",
          "type",
          "collection",
          "tags",
          "images",
        ],
        select: [
          "id",
          "title",
          "subtitle",
          "description",
          "handle",
          "is_giftcard",
          "discountable",
          "thumbnail",
          "weight",
          "length",
          "height",
          "width",
          "hs_code",
          "origin_country",
          "mid_code",
          "material",
          "metadata",
        ],
      });

      if (product) {
        return await this.createEntryInStrapi("products", productId, product);
      }
    } catch (error) {
      throw error;
    }
  }

  async createProductVariantInStrapi(variantId):Promise<any> {
    const hasType = await this.getType("product-variants")
        .then(() => true)
        .catch((e) => false);

    if (!hasType) {
      return Promise.resolve();
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const variant = await this.productVariantService_.retrieve(variantId, {
        relations: ["prices", "options", "product"],
      });

      // this.logger.info(variant)
      if (variant) {
        return await this.createEntryInStrapi(
            "product-variants",
            variantId,
            variant,
        );
      }
    } catch (error) {
      throw error;
    }
  }

  async createRegionInStrapi(regionId):Promise<any> {
    const hasType = await this.getType("regions")
        .then(() => true)
        .catch(() => false);
    if (!hasType) {
      this.logger.info('Type "Regions" doesnt exist in Strapi');
      return Promise.resolve();
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const region = await this.regionService_.retrieve(regionId, {
        relations: [
          "countries",
          "payment_providers",
          "fulfillment_providers",
          "currency",
        ],
        select: ["id", "name", "tax_rate", "tax_code", "metadata"],
      });

      // this.logger.info(region)

      return await this.createEntryInStrapi("regions", regionId, region);
    } catch (error) {
      throw error;
    }
  }

  async updateRegionInStrapi(data): Promise<any> {
    const hasType = await this.getType("regions")
        .then((res) => {
        // this.logger.info(res.data)
          return true;
        })
        .catch((error) => {
        // this.logger.info(error.response.status)
          return false;
        });
    if (!hasType) {
      return Promise.resolve();
    }

    const updateFields = [
      "name",
      "currency_code",
      "countries",
      "payment_providers",
      "fulfillment_providers",
    ];

    // check if update contains any fields in Strapi to minimize runs
    const found = data.fields.find((f) => updateFields.includes(f));
    if (!found) {
      return;
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi");
      if (ignore) {
        return;
      }

      const region = await this.regionService_.retrieve(data.id, {
        relations: [
          "countries",
          "payment_providers",
          "fulfillment_providers",
          "currency",
        ],
        select: ["id", "name", "tax_rate", "tax_code", "metadata"],
      });
      // this.logger.info(region)

      if (region) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi(
            "regions",
            region.id,
            region,
        );
        this.logger.info("Region Strapi Id - ", response);
      }

      return region;
    } catch (error) {
      throw error;
    }
  }

  async updateProductInStrapi(data):Promise<any> {
    const hasType = await this.getType("products")
        .then((res) => {
        // this.logger.info(res.data)
          return true;
        })
        .catch((error) => {
        // this.logger.info(error.response.status)
          return false;
        });
    if (!hasType) {
      return Promise.resolve();
    }

    // this.logger.info(data)
    const updateFields = [
      "variants",
      "options",
      "tags",
      "title",
      "subtitle",
      "tags",
      "type",
      "type_id",
      "collection",
      "collection_id",
      "thumbnail",
    ];

    // check if update contains any fields in Strapi to minimize runs
    const found = data.fields.find((f) => updateFields.includes(f));
    if (!found) {
      return Promise.resolve();
    }

    // eslint-disable-next-line no-useless-catch
    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi");
      if (ignore) {
        this.logger.info(
            "Strapi has just updated this product"+
            " which triggered this function. IGNORING... ",
        );
        return Promise.resolve();
      }
      const product = await this.productService_.retrieve(data.id, {
        relations: [
          "options",
          "variants",
          "variants.prices",
          "variants.options",
          "type",
          "collection",
          "tags",
          "images",
        ],
        select: [
          "id",
          "title",
          "subtitle",
          "description",
          "handle",
          "is_giftcard",
          "discountable",
          "thumbnail",
          "weight",
          "length",
          "height",
          "width",
          "hs_code",
          "origin_country",
          "mid_code",
          "material",
          "metadata",
        ],
      });

      if (product) {
        await this.updateEntryInStrapi("products", product.id, product);
      }

      return product;
    } catch (error) {
      throw error;
    }
  }


  async updateProductVariantInStrapi(data):Promise<any> {
    let hasType:boolean;
    try {
      const result = await this.getType("product-variants");
      hasType=result?true:false;
    } catch (error) {
      this.logger.error(error);
      return false;
    }
    if (!hasType) {
      return Promise.resolve();
    }

    const updateFields = [
      "title",
      "prices",
      "sku",
      "material",
      "weight",
      "length",
      "height",
      "origin_country",
      "options",
    ];

    // Update came directly from product variant service so only act on a couple
    // of fields. When the update comes from the product we want to ensure
    // references are set up correctly so we run through everything.
    if (data.fields) {
      const found = data.fields.find((f) => updateFields.includes(f));
      if (!found) {
        return Promise.resolve();
      }
    }

    try {
      const ignore = await this.shouldIgnore_(data.id, "strapi");
      if (ignore) {
        return Promise.resolve();
      }

      const variant = await this.productVariantService_.retrieve(data.id, {
        relations: ["prices", "options"],
      });
      this.logger.info(variant);

      if (variant) {
        // Update entry in Strapi
        const response = await this.updateEntryInStrapi(
            "product-variants",
            variant.id,
            variant,
        );
        this.logger.info("Variant Strapi Id - ", response);
      }

      return variant;
    } catch (error) {
      this.logger.info("Failed to update product variant", data.id);
      throw error;
    }
  }

  async deleteProductInStrapi(data):Promise<any> {
    const hasType = await this.getType("products")
        .then(() => true)
        .catch((err) => {
          this.logger.info(err);
          return false;
        });
    if (!hasType) {
      return Promise.resolve();
    }

    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) {
      return Promise.resolve();
    }

    return await this.deleteEntryInStrapi("products", data.id);
  }

  async deleteProductVariantInStrapi(data) :Promise<any> {
    const hasType = await this.getType("product-variants")
        .then(() => true)
        .catch((err) => {
        // this.logger.info(err)
          return false;
        });
    if (!hasType) {
      return Promise.resolve();
    }

    const ignore = await this.shouldIgnore_(data.id, "strapi");
    if (ignore) {
      return Promise.resolve();
    }

    return await this.deleteEntryInStrapi("product-variants", data.id);
  }

  // Blocker - Delete Region API
  async deleteRegionInStrapi(data):Promise<any> {
    return;
  }

  async getType(type:string, username?: string, email?:string,
      password?: string) :Promise<AxiosResponse> {
    const loginRespone = await this.loginToStrapi(email, password) as AxiosResponse
    console.log(loginRespone);
    this.strapiDefaultUserAuthToken =
    loginRespone.data.jwt;

    const config = {
      url: `${this.strapi_url}/api/${type}`,
      method: "get",
      headers: {
        Authorization: `Bearer ${this.strapiDefaultUserAuthToken}`,
      },
    };

    const result = await axios.get(config.url, {
      headers: config.headers,
    });
    return result;
  }

  async checkStrapiHealth():Promise<boolean> {
    const config = {
      url: `${this.strapi_url}/_health`,
    };
    this.logger.info("Checking strapi Health");
    const response = await axios.head(config.url);
    this.isHealthy = response.status == 204 ? true:false;
    return this.isHealthy;
  }

  encrypt(text:string):any {
    return text;
    const cipher = crypto.createCipheriv("aes-256-cbc",
        Buffer.from(this.key), this.iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return { iv: this.iv.toString("hex"),
      encryptedData: encrypted.toString("hex") };
  }

  // Decrypting text
  decrypt(text):string {
    return text;
    const iv = Buffer.from(text.iv, "hex");
    const encryptedText = Buffer.from(text.encryptedData, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc",
        Buffer.from(this.key), this.iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  }

  async registerDefaultMedusaUser() :Promise<AxiosResponse> {
    try {
      const authParams = {
        username: this.options_.strapi_default_user_username,
        email: this.options_.strapi_default_user_email_address,
        password: this.options_.strapi_default_user_password,
        firstname: this.options_.strapi_default_user_firstname,
        lastname: this.options_.strapi_default_user_lastname,
      };
      const response = await this.registerMedusaUser(authParams);
      console.log(response);
      this.strapiDefaultUserAuthToken = response.data.jwt;
      this.strapiDefaultUserProfile = response.data.user;
      this.strapiDefaultUserId = response.data.user.id;
      return response;
    } catch (error) {
      this.logger.error("unable to register default user",
          (error as Error).message);
    }
  }

  async deleteDefaultMedusaUser() :Promise<AxiosResponse> {
    try {
      const response = await this.
          deleteMedusaUserFromStrapi(this.strapiDefaultUserId);
      this.strapiDefaultUserAuthToken = undefined;
      this.strapiDefaultUserProfile = undefined;
      return response;
    } catch (error) {
      this.logger.error("unable to delete default user",
          (error as Error).message);
    }
  }

  async deleteMedusaUserFromStrapi(id:string):Promise<AxiosResponse> {
    return await this.strapiSend("delete", "users", id);
  }

  /* async deleteMedusaUserFromStrapi(id:string,
  ):Promise<AxiosResponse> {
    try {
      const response = await axios
          .delete(`${this.strapi_url}/api/users/${id}`,
              {
                headers: {
                  Authorization:
              `Bearer ${this.strapiAdminAuthToken}`,
                },
              });

      console.log(response);

      this.logger.info("Delete "+id+" from strapi");
      return response;
    } catch (error) {
      // Handle error.
      this.logger.info("An error occurred during delete:",
          (error as Error).message);
    }
    return;
  }*/
  /** Todo Create API based access
  async fetchMedusaUserApiKey(emailAddress) {

    return await this.strapiAdminSend("get")
  }

  */


  async configureStrapiMedusa(): Promise<any> {
    try {
      const result= await axios.post(`${
        this.strapi_url}/api/synchronise-medusa-tables`, {});
      this.logger.info("successfully configured two way sync<-->medusa");
      return result;
    } catch (error) {
      // Handle error.
      this.logger.info("An error occurred:", error);
    }
  }

  async loginToStrapi(email:string,
      password:string):Promise<AxiosResponse|boolean> {
    if (await this.checkStrapiHealth()) {
      this.logger.info("strapi is healthy");
    } else {
      return false;
    }
    const authData = {
      identifier: email?? this.options_.strapi_default_user_email_address,
      password: password?this.encrypt(password):
      this.encrypt(this.options_.strapi_default_user_password),
    };
    try {
      const res = await axios.post(`${this.strapi_url}/api/auth/local`,
          authData);
      console.log(res);
      if (res.data.jwt) {
        this.logger.info(`\n  ${authData.
            identifier} successfully logged in to Strapi \n`);
        return res;
      }
      return false;
    } catch (error) {
      throw new Error(`\n Error  ${authData.
          identifier} while trying to login to strapi\n`+
      error);
    }

    return;
  }

  async doesEntryExistInStrapi(type, id):Promise<AxiosResponse> {
    return await this.strapiSend("get", type, id);
  }

  async createEntryInStrapi(type, id, data):Promise<AxiosResponse> {
    return await this.strapiSend("post", type, id, data);
  }

  async updateEntryInStrapi(type, id, data) :Promise<AxiosResponse> {
    return await this.strapiSend("put", type, id, data);
  }

  async deleteEntryInStrapi(type, id) :Promise<AxiosResponse> {
    return await this.strapiSend("delete", type, id);
  }

  async strapiSend(method:Method, type:string,
      id:string, data?:any, username?:
      string, password?:string, email?:string): Promise<AxiosResponse> {
    const result = await this.loginToStrapi(email, password);
    if (!result) {
      this.logger.error("No user Bearer token");
      return;
    }
    if (await this.checkStrapiHealth()) {
      this.logger.info("strapi is healthy");
    } else {
      this.logger.info("strapi is unhealthy");
      return;
    }

    const resp = result as AxiosResponse;
    const endPoint = `${this.strapi_url}/api/${type}/${id}`;
    this.logger.info(endPoint);
    const basicConfig = { method: method,
      url: endPoint,
      headers: {
        Authorization: `Bearer ${resp.data.jwt}`,
      },
    };
    const config = data?{
      ...basicConfig,
      data,
    }:{
      ...basicConfig,
    };
    try {
      const result = await axios({ ...config });
      if (result.status >= 200 && result.status<300) {
        this.logger.info(
            `St1rapi Ok : ${method}, ${id}, ${type}, ${data}, :status:${result
                .status}`);
      }

      return result;
    } catch (error) {
      this.logger.info((error as Error).message);
      throw new Error(`Error while trying to ${method}  entry in strapi `);
    }
  }


  async strapiAdminSend(method:Method, type:string,
      id?:string, action?:string, data?:any,
  ): Promise<AxiosResponse> {
    const result = await this.loginAsStrapiAdmin();
    if (!result) {
      this.logger.error("No user Bearer token, check axios request");
      return;
    }
    if (await this.checkStrapiHealth()) {
      this.logger.info("strapi is healthy");
    } else {
      this.logger.info("strapi is unhealthy");
      return;
    }
    let headers = undefined;
    if (this.strapiAdminAuthToken) {
      headers={
        Authorization: `Bearer ${this.strapiAdminAuthToken}`,
      };
    }
    const path = [];
    const items = [type, action, id];
    for (const item of items) {
      if (item) {
        path.push(item);
      }
    }
    const basicConfig = { method: method,
      url: `${this.strapi_url}/admin/${path.join("/")}`,
      headers,
    };
    const config = data?{
      ...basicConfig,
      data,
    }:{
      ...basicConfig,
    };
    try {
      const result = await axios({ ...config });
      if (result.status >= 200 && result.status<300) {
        this.logger.info(
            `Strapi Ok : ${method}, ${id}, ${
              type}, ${data}, ${action} :status:${result
                .status}`);
        this.logger.info(
            `Strapi Data : ${result.data}`);
      }

      return result;
    } catch (error) {
      this.logger.info((error as Error).message);
      throw new Error(`Error while admin ${
        method}, ${id}, ${type}, ${JSON.
          stringify(data)}, ${action} in strapi `);
    }
  }

  /* async registerMedusaUser(auth:UserType):Promise<AxiosResponse> {
    return await this.strapiAdminSend("post",
        "user", undefined, undefined, auth);
  }*/
  de;
  async registerMedusaUser(auth:UserType):Promise<AxiosResponse> {
    try {
      const response = await axios.
          post(`${this.strapi_url}/api/auth/local/register`, auth,
          );
      return response;
    } catch (e) {
      this.logger.error("unable to register user"+JSON.stringify(e));
    }
  }


  async registerAdminUserInStrapi():Promise<AxiosResponse> {
    const auth:UserType = {
      email: this.options_.strapi_admin_email,
      username: this.options_.strapi_admin_username,
      firstname: this.options_.strapi_admin_firstname,
      lastname: this.options_.strapi_admin_lastname,
      password: this.options_.strapi_admin_secret,
    };

    return await this.strapiAdminSend("post", "register-admin",
        undefined, undefined, auth);

    try {
      const response = await axios.post(`${
        this.strapi_url}/admin/register-admin`, auth);
      this.logger.info("Registered Admin " + auth.email + " with strapi");
      this.logger.info("Admin profile", response.data.user);
      this.logger.info("Admin token", response.data.token);
      // console.log(response);
      this.strapiAdminAuthToken = response.data.token;
      this.userAdminProfile = response.data.user;
      return response;
    } catch (error) {
      // Handle error.
      this.logger.info("An error occurred:", error);
      throw error;
    }
  }

  async loginAsStrapiAdmin():Promise<AxiosResponse> {
    const auth = {
      email: this.options_.strapi_admin_email,
      password: this.options_.strapi_admin_secret,
    };

    try {
      let response = await axios
          .post(`${this.strapi_url}/admin/login`, auth, {
            headers: {
              "Content-Type": "application/json",
            },
          });
      response = response.data;
      this.logger.info("Logged In   Admin " + auth.email + " with strapi");
      this.logger.info("Admin profile", response.data.user);
      this.logger.info("Admin token", response.data.token);

      this.strapiAdminAuthToken = response.data.token;
      this.userAdminProfile = response.data.user;
      return response;
    } catch (error) {
      // Handle error.
      this.logger.info("An error occurred"+
       "while logging into admin:", error.message);
      throw error;
    }
  }
  async intializeServer(): Promise<AxiosResponse> {
    await this.registerOrLoginAdmin();
    if (this.strapiAdminAuthToken) {
      const user = await this.registerDefaultMedusaUser();
      if (user) {
        const response = await this.configureStrapiMedusa();
        if (response.status < 300) {
          this.logger.info("medusa-strapi-successfully-bootstrapped");
          return response;
        }
      }
    }
  }
  async registerOrLoginAdmin():Promise<void> {
    try {
      await this.registerAdminUserInStrapi();
    } catch (e) {
      this.logger.info("super admin already registered", JSON.stringify(e));
    }
    await this.loginAsStrapiAdmin();
  }

  async loginAsDefaultUser():Promise<AxiosResponse> {
    try {
      const authParams = {
        email: this.options_.strapi_default_user_email_address,
        password: this.options_.strapi_default_user_password,
      };
      const response = await this.loginToStrapi(authParams.email,
          authParams.password);
      if (response) {
        const axiosResp = response as AxiosResponse;
        console.log(response);
        this.strapiDefaultUserAuthToken = axiosResp.data.jwt;
        this.strapiDefaultUserProfile = axiosResp.data.user;
        this.strapiDefaultUserId = axiosResp.data.user.id;
        return axiosResp;
      }
    } catch (error) {
      this.logger.error("unable to register default user",
          (error as Error).message);
    }
  }


  async registerOrLoginDefaultUser():Promise<void> {
    try {
      await this.registerDefaultMedusaUser();
    } catch (e) {
      this.logger.info("default user already registered", JSON.stringify(e));
    }
    await this.loginAsDefaultUser();
  }
}


export default UpdateStrapiService;
