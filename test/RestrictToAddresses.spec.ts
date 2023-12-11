import {loadFixture} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseUnits } from 'viem';
import hre from "hardhat";
import orderType from "./utils/orderType";
import { seaportAddress, zeroHash } from "./utils/constants";
import generateSalt from "./utils/generateSalt";
import getBlockTimestamp from "./utils/getBlockTimestamp";
import seaportFixture from "./fixtures/seaportFixture";
import accountsFixture from "./fixtures/accountsFixture";

describe("RestrictToAddresses Zone tests", function () {

    async function fixture() {
        const sf = await seaportFixture();
        const af = await accountsFixture();

        const restrictToAddressesZone = await hre.viem.deployContract('RestrictToAddresses', [sf.seaport.address]);
        async function getRestrictToAddressesZone(client: typeof af.alice) {
            return await hre.viem.getContractAt(
                "IRestrictToAddresses",
                restrictToAddressesZone.address,
                {
                walletClient: client
                }
            );
        }

        return {
            ...sf,
            ...af,
            restrictToAddressesZone,
            getRestrictToAddressesZone
        }
    }

    describe("erc20<->erc20", function () {

        /*
            Restrict the trade to a specific set of takers
            - only allow complete fills
            - we expect that after one taker fills the order, others can't do the same after
        */
        it("multiple recipients, complete fill by first", async function () {
            const { 
                alice, 
                bob, 
                charlie, 
                dan,
                seaport, 
                usdc, 
                weth, 
                getSeaport, 
                getUsdc, 
                getWeth, 
                aliceStartingUsdcBalance, 
                startingWethBalance, 
                restrictToAddressesZone, 
                getRestrictToAddressesZone 
            } = await loadFixture(fixture);

            // amounts
            const timestamp = await getBlockTimestamp();
            const usdcTradeAmount = parseUnits("1000", 6);
            const wethTradeamount = parseUnits("1", 18);

            // alice will designate that only bob and charlie can fill the trade
            // alice, bob, and charlie approve seaport contract
            await (await getUsdc(alice)).write.approve([
                seaportAddress,
                usdcTradeAmount
            ]);
            await (await getWeth(bob)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await (await getWeth(charlie)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);

            // construct order
            const salt = generateSalt();
            const baseOrderParameters = {
                offerer: alice.account.address,
                zone: restrictToAddressesZone.address,

                // this is what the trader is giving
                offer: [
                    {
                        itemType: 1, // 1 == erc20
                        token: usdc.address,
                        identifierOrCriteria: 0n, // criteria not used for erc20s
                        startAmount: usdcTradeAmount,
                        endAmount: usdcTradeAmount,
                    }
                ],

                // what the trader expects to receive
                consideration: [
                    {
                        itemType: 1,
                        token: weth.address,
                        identifierOrCriteria: 0n,
                        startAmount: wethTradeamount,
                        endAmount: wethTradeamount,
                        recipient: alice.account.address,
                    }
                ],
                orderType: 2, // full restricted
                startTime: timestamp,
                endTime: timestamp + 86400n, // 24 hours from now

                // using RestrictToAddresses, the user will interact with the zone directly, rather than through this signature 
                zoneHash: zeroHash, 

                salt: salt,
                conduitKey: zeroHash, // not using a conduit
            };
            const orderParameters = {
                ...baseOrderParameters,
                totalOriginalConsiderationItems: 1n
            }

            // get contract info
            const info = await seaport.read.information();
            const version = info[0];
            const name = await seaport.read.name();
            const domainData = {
                name: name,
                version: version,

                // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
                chainId: 31337,
                verifyingContract: seaportAddress,
            };
            const counter = await seaport.read.getCounter([alice.account.address]);
            const orderComponents = {
                ...baseOrderParameters,
                counter: counter,
            }

            // restrict to addresses
            await (await getRestrictToAddressesZone(alice)).write.setAllowedAddresses([
                orderComponents,
                [bob.account.address, charlie.account.address]
            ]);

            // alice signs the order
            const signature = await alice.signTypedData({
                domain: domainData,
                types: orderType,
                primaryType: 'OrderComponents',
                message: orderComponents
            });
            const order = {
                parameters: orderParameters,
                signature: signature
            };

            // although alice intends for bob or charlie to fill the order,
            // let's pretend that dan somehow intercepts alice's signed message
            // dan should still not be able to fill the order
            await (await getWeth(dan)).write.approve([
                seaportAddress,
                wethTradeamount
            ]);
            await expect(
                (await getSeaport(dan)).write.fulfillOrder([
                    order,
                    zeroHash
                ])
            ).to.be.rejectedWith(
                'ORDER_RESTRICTED'
            );

            // bob will take the swap
            // check for expected starting balances
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

            // bob receives the signed order and fulfills it
            await (await getSeaport(bob)).write.fulfillOrder([
                order,
                zeroHash
            ]);

            // check that the swap was correct
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeamount);
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(0n);

            // charlie tries to fill the order
            await expect(
                (await getSeaport(charlie)).write.fulfillOrder([
                    order,
                    zeroHash
                ])
            ).to.be.rejectedWith(
                'VM Exception while processing transaction: reverted with an unrecognized custom error'
            );
        });

        /*
            Restrict the trade to a specific set of takers
            - allow partial fills
        */
        it("multiple recipients, partial fills", async function () {
            const { 
                alice, 
                bob, 
                charlie, 
                dan,
                erin,
                seaport, 
                usdc, 
                weth, 
                getSeaport, 
                getUsdc, 
                getWeth, 
                aliceStartingUsdcBalance, 
                startingWethBalance, 
                restrictToAddressesZone, 
                getRestrictToAddressesZone 
            } = await loadFixture(fixture);

            // amounts
            const timestamp = await getBlockTimestamp();
            const usdcTradeAmount = parseUnits("1000", 6);
            const wethTradeAmount = parseUnits("1", 18);

            // alice will designate that bob, charlie, and dan can fill the trade
            // alice, bob, charlie, and dan approve seaport contract
            await (await getUsdc(alice)).write.approve([
                seaportAddress,
                usdcTradeAmount
            ]);
            await (await getWeth(bob)).write.approve([
                seaportAddress,
                wethTradeAmount
            ]);
            await (await getWeth(charlie)).write.approve([
                seaportAddress,
                wethTradeAmount
            ]);
            await (await getWeth(dan)).write.approve([
                seaportAddress,
                wethTradeAmount
            ]);

            // construct order
            const salt = generateSalt();
            const baseOrderParameters = {
                offerer: alice.account.address,
                zone: restrictToAddressesZone.address,

                // this is what the trader is giving
                offer: [
                    {
                        itemType: 1, // 1 == erc20
                        token: usdc.address,
                        identifierOrCriteria: 0n, // criteria not used for erc20s
                        startAmount: usdcTradeAmount,
                        endAmount: usdcTradeAmount,
                    }
                ],

                // what the trader expects to receive
                consideration: [
                    {
                        itemType: 1,
                        token: weth.address,
                        identifierOrCriteria: 0n,
                        startAmount: wethTradeAmount,
                        endAmount: wethTradeAmount,
                        recipient: alice.account.address,
                    }
                ],
                orderType: 3, // partial restricted
                startTime: timestamp,
                endTime: timestamp + 86400n, // 24 hours from now

                // using RestrictToAddresses, the user will interact with the zone directly, rather than through this signature 
                zoneHash: zeroHash, 

                salt: salt,
                conduitKey: zeroHash, // not using a conduit
            };
            const orderParameters = {
                ...baseOrderParameters,
                totalOriginalConsiderationItems: 1n
            }

            // get contract info
            const info = await seaport.read.information();
            const version = info[0];
            const name = await seaport.read.name();
            const domainData = {
                name: name,
                version: version,

                // although we are forking eth mainnet, hardhat uses this chainId instead of the actual chainId (in this case, 1)
                chainId: 31337,
                verifyingContract: seaportAddress,
            };
            const counter = await seaport.read.getCounter([alice.account.address]);
            const orderComponents = {
                ...baseOrderParameters,
                counter: counter,
            }

            // restrict to addresses
            await (await getRestrictToAddressesZone(alice)).write.setAllowedAddresses([
                orderComponents,
                [bob.account.address, charlie.account.address, dan.account.address]
            ]);

            // alice signs the order
            const signature = await alice.signTypedData({
                domain: domainData,
                types: orderType,
                primaryType: 'OrderComponents',
                message: orderComponents
            });
            const order = {
                parameters: orderParameters,
                signature: signature
            };

            // although alice intends for bob, charlie, and dan to fill the order,
            // let's pretend that erin somehow intercepts alice's signed message
            // erin should still not be able to fill the order
            await (await getWeth(erin)).write.approve([
                seaportAddress,
                wethTradeAmount
            ]);
            await expect(
                (await getSeaport(erin)).write.fulfillOrder([
                    order,
                    zeroHash
                ])
            ).to.be.rejectedWith(
                'ORDER_RESTRICTED'
            );

            // bob and charlie will each take half the swap

            // check for expected starting balances
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(aliceStartingUsdcBalance);
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(startingWethBalance);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(0n);

            // bob receives the signed order and fulfills half of it
            const advancedOrder = {
                parameters: orderParameters,
                numerator: wethTradeAmount / 2n,
                denominator: wethTradeAmount,
                signature: signature,
                extraData: zeroHash
            }
            await (await getSeaport(bob)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                bob.account.address
            ]);

            // check that the swap was correct
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeAmount / 2n);
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(usdcTradeAmount / 2n);
            expect(await usdc.read.balanceOf([bob.account.address])).to.eq(usdcTradeAmount / 2n);
            expect(await weth.read.balanceOf([bob.account.address])).to.eq(wethTradeAmount / 2n);

            // check charlie's expected starting balances
            expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(0n);
            expect(await weth.read.balanceOf([charlie.account.address])).to.eq(startingWethBalance);

            // charlie fills the rest of the order
            await (await getSeaport(charlie)).write.fulfillAdvancedOrder([
                advancedOrder,
                [],
                zeroHash,
                charlie.account.address
            ]);

            // check that the swap was correct
            expect(await weth.read.balanceOf([alice.account.address])).to.eq(wethTradeAmount);
            expect(await usdc.read.balanceOf([alice.account.address])).to.eq(0n);
            expect(await usdc.read.balanceOf([charlie.account.address])).to.eq(usdcTradeAmount / 2n);
            expect(await weth.read.balanceOf([charlie.account.address])).to.eq(wethTradeAmount / 2n);

            // now that the order is completely filled, dan's fulfillment should fail
            await expect(
                (await getSeaport(dan)).write.fulfillOrder([
                    order,
                    zeroHash
                ])
            ).to.be.rejectedWith(
                'VM Exception while processing transaction: reverted with an unrecognized custom error'
            );
        });
    });
});
