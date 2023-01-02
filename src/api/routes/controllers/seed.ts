import {
    FulfillmentProviderService,
    PaymentProviderService,
    Product,
    ProductService,
    Region,
    RegionService,
    ShippingOptionService,
    ShippingProfileService
} from "@medusajs/medusa";
import { Request, Response } from "express";
import { asFunction, asValue } from "awilix";

export default async (req: Request, res: Response) => {
    try {
        const manager = req.scope.resolve("manager");
        let syncInProgress: boolean;
        try {
            /** to handle asynchronous requests */
            syncInProgress = req.scope.resolve("syncInProgress");
            if (syncInProgress) {
                res.status(200).send({ status: "Sync in progress" });
                return;
            }
        } catch (e) {
            req.scope.register("syncInProgress", asValue(true));
        }

        const productService = req.scope.resolve(
            "productService"
        ) as ProductService;
        const regionService = req.scope.resolve(
            "regionService"
        ) as RegionService;
        const paymentProviderService = req.scope.resolve(
            "paymentProviderService"
        ) as PaymentProviderService;
        const fulfillmentProviderService = req.scope.resolve(
            "fulfillmentProviderService"
        ) as FulfillmentProviderService;
        const shippingProfileService = req.scope.resolve(
            "shippingProfileService"
        ) as ShippingProfileService;
        const shippingOptionService = req.scope.resolve(
            "shippingOptionService"
        ) as ShippingOptionService;
        const regionRepository = req.scope.resolve("regionRepository");
        const shippingProfileRepository = req.scope.resolve(
            "shippingProfileRepository"
        );
        const shippingOptionRepository = req.scope.resolve(
            "shippingOptionRepository"
        );
        const allProductsCount = await productService.count();
        const allRegionCount = await getCount(manager, regionRepository);
        const allShippingProfileCount = await getCount(
            manager,
            shippingProfileRepository
        );
        const allShippingOptionCount = await getCount(
            manager,
            shippingOptionRepository
        );

        const storeService = req.scope.resolve("storeService");

        const productFields = [
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
            "metadata"
        ];
        const regionFields: any = [
            "id",
            "name",
            "tax_rate",
            "tax_code",
            "metadata"
        ];
        const shippingProfileFields = ["id", "name", "type", "metadata"];
        const shippingOptionFields = [
            "id",
            "name",
            "price_type",
            "amount",
            "is_return",
            "admin_only",
            "data",
            "metadata"
        ];

        const productRelations = [
            "variants",
            "variants.prices",
            "variants.options",
            "images",
            "options",
            "tags",
            "type",
            "collection",
            "profile"
        ];
        const regionRelations = [
            "countries",
            "payment_providers",
            "fulfillment_providers",
            "currency"
        ];
        const shippingProfileRelations = [
            "products",
            "shipping_options",
            "shipping_options.profile",
            "shipping_options.requirements",
            "shipping_options.provider",
            "shipping_options.region",
            "shipping_options.region.countries",
            "shipping_options.region.payment_providers",
            "shipping_options.region.fulfillment_providers",
            "shipping_options.region.currency"
        ];
        const shippingOptionRelations = [
            "region",
            "region.countries",
            "region.payment_providers",
            "region.fulfillment_providers",
            "region.currency",
            "profile",
            "profile.products",
            "profile.shipping_options",
            "requirements",
            "provider"
        ];

        // Fetching all entries at once. Can be optimized
        const productListConfig: any = {
            skip: 0,
            take: allProductsCount,
            select: productFields,
            relations: productRelations
        };
        const regionListConfig = {
            skip: 0,
            take: allRegionCount,
            select: regionFields,
            relations: regionRelations
        };
        const shippingOptionsConfig: any = {
            skip: 0,
            take: allShippingOptionCount,
            select: shippingOptionFields,
            relations: shippingOptionRelations
        };
        const shippingProfileConfig: any = {
            skip: 0,
            take: allShippingProfileCount,
            select: shippingProfileFields,
            relations: shippingProfileRelations
        };

        const allRegions = await regionService.list({}, regionListConfig);
        const allProducts = await productService.list({}, productListConfig);
        const allPaymentProviders = await paymentProviderService.list();
        const allFulfillmentProviders = await fulfillmentProviderService.list();
        const allShippingOptions = await shippingOptionService.list(
            {},
            shippingOptionsConfig
        );
        const allShippingProfiles = await shippingProfileService.list(
            {},
            shippingProfileConfig
        );

        const response = {
            products: allProducts,
            regions: allRegions,
            paymentProviders: allPaymentProviders,
            fulfillmentProviders: allFulfillmentProviders,
            shippingOptions: allShippingOptions,
            shippingProfiles: allShippingProfiles
        };

        res.status(200).send(response);
        req.scope.registerAdd("syncInProgress", asValue(false));
    } catch (error) {
        res.status(400).send(`Webhook error: ${error.message}`);
    }
};

// eslint-disable-next-line valid-jsdoc
/**
 * Return total number of entries for a repository
 * @return {*}
 */
function getCount(manager, repository) {
    const customRepository = manager.getCustomRepository(repository);
    return customRepository.count();
}
